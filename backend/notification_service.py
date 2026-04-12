# ===================================================
# IMPORTS
# ===================================================

# Standard libraries
import os                     # Used to access environment variables
import re                     # Used for text cleaning (doctor name, phone number)
import json
import urllib.request
import urllib.error

# ThreadPoolExecutor allows notifications to run in background threads
from concurrent.futures import ThreadPoolExecutor

# Flask object used to access application configuration and logging
from flask import current_app


# Try importing Flask-Mail for sending email notifications
# If the library is not installed, Message will be None
try:
    from flask_mail import Message
except Exception:
    Message = None


# Try importing Twilio client for sending SMS notifications
# If Twilio SDK is not installed, Client will be None
try:
    from twilio.rest import Client
except Exception:
    Client = None


# Thread pool used to execute notification sending asynchronously
# This prevents API responses from waiting for email/SMS sending
_notification_executor = ThreadPoolExecutor(max_workers=4)


# ===================================================
# EMAIL SUBJECT BUILDER
# ===================================================

def _build_email_subject():
    """Return the email subject used in appointment notifications."""
    return "Appointment Status Update"


def _build_password_reset_subject():
    """Return the subject used for password reset emails."""
    return "Password Reset Request"


# ===================================================
# DOCTOR NAME FORMATTER
# ===================================================

def _format_doctor_name(raw_name):
    """
    Normalize doctor name by removing repeated 'Dr.' prefixes.
    Example: 'Dr. Dr. John Smith' -> 'John Smith'
    """
    name = str(raw_name or "").strip()

    # Remove repeated "Dr." prefixes
    name = re.sub(r"^(dr\.?\s*)+", "", name, flags=re.IGNORECASE)

    # Default fallback name
    return name or "Doctor"


# ===================================================
# PHONE NUMBER NORMALIZATION
# ===================================================

def _normalize_phone_number(raw_number):
    """
    Normalize phone numbers to international format.
    Removes spaces, symbols and ensures a +countrycode prefix.
    """
    cleaned = re.sub(r"[^\d+]", "", str(raw_number or "").strip())
    default_country_code = str(
        current_app.config.get("DEFAULT_PHONE_COUNTRY_CODE") or ""
    ).strip()

    # Convert numbers starting with 00 to + format
    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"

    # Convert local numbers using the configured default country code.
    if cleaned and not cleaned.startswith("+") and default_country_code:
        normalized_cc = default_country_code if default_country_code.startswith("+") else f"+{default_country_code}"
        local_number = cleaned[1:] if cleaned.startswith("0") else cleaned
        if local_number.isdigit():
            cleaned = f"{normalized_cc}{local_number}"

    # If number has no + but seems international, add +
    if cleaned and not cleaned.startswith("+") and cleaned.isdigit() and len(cleaned) >= 11:
        cleaned = f"+{cleaned}"

    return cleaned


# ===================================================
# EMAIL BODY BUILDER
# ===================================================

def _build_email_body(payload):
    """
    Build the email message body using appointment data.
    """
    status = payload["status"]

    appointment_day = payload.get("appointment_day")
    appointment_day_text = f"{appointment_day}, " if appointment_day else ""

    doctor_name = _format_doctor_name(payload.get("doctor_name"))

    # Different guidance depending on appointment status
    if status == "APPROVED":
        guidance = "Please arrive on time for your consultation."
    elif status == "REJECTED":
        guidance = "Please book another available time slot."
    else:
        guidance = "Your request is pending review. We will notify you as soon as it is confirmed."

    return (
        f"Hello {payload['patient_name']},\n\n"
        f"Your appointment request with Dr. {doctor_name} on "
        f"{appointment_day_text}{payload['appointment_date']} at {payload['appointment_time']} "
        f"has been {status}.\n\n"
        f"{guidance}\n\n"
        "Thank you."
    )


def _build_password_reset_body(reset_link):
    """Build the password reset email body."""
    return (
        "A password reset was requested for your account.\n\n"
        f"Use this link to choose a new password:\n{reset_link}\n\n"
        "This link expires in 30 minutes and can only be used once.\n"
        "If you did not request this change, you can ignore this email."
    )


def _build_email_html(payload):
    """Return a lightweight HTML version of the appointment notification."""
    return (
        f"<p>Hello {payload['patient_name']},</p>"
        f"<p>Your appointment request with Dr. {_format_doctor_name(payload.get('doctor_name'))} "
        f"on {payload['appointment_date']} at {payload['appointment_time']} has been "
        f"<strong>{payload['status']}</strong>.</p>"
        f"<p>{_build_email_body(payload).splitlines()[2]}</p>"
        "<p>Thank you.</p>"
    )


def _build_password_reset_html(reset_link):
    """Return a lightweight HTML version of the password reset email."""
    return (
        "<p>A password reset was requested for your account.</p>"
        f"<p>Use this link to choose a new password:<br><a href=\"{reset_link}\">{reset_link}</a></p>"
        "<p>This link expires in 30 minutes and can only be used once.</p>"
        "<p>If you did not request this change, you can ignore this email.</p>"
    )


def _send_resend_email(recipient_email, subject, text_body, html_body=None):
    """Send an email through the Resend HTTP API."""
    api_key = current_app.config.get("RESEND_API_KEY")
    from_email = current_app.config.get("RESEND_FROM_EMAIL")
    from_name = (current_app.config.get("RESEND_FROM_NAME") or "Wisdom Hospital").strip()

    current_app.logger.info(
        "RESEND CONFIG CHECK | api_key_present=%s | from_email_present=%s | recipient_present=%s",
        bool(api_key),
        bool(from_email),
        bool(recipient_email)
    )

    if not api_key or not from_email or not recipient_email:
        return None

    payload = {
        "from": f"{from_name} <{from_email}>",
        "to": [recipient_email],
        "subject": subject,
        "text": text_body
    }

    if html_body:
        payload["html"] = html_body

    request_obj = urllib.request.Request(
        url="https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "doctor-appointment-booking-system/1.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=20) as response:
            body = response.read().decode("utf-8") if response else ""
            parsed = json.loads(body) if body else {}
            return {
                "sent": True,
                "provider": "resend",
                "provider_id": parsed.get("id")
            }
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace") if error.fp else str(error)
        raise RuntimeError(f"Resend API error: {error.code} {error_body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Resend network error: {error.reason}") from error


def _is_resend_configured():
    """Return True when Resend is configured and should be preferred."""
    return bool(
        current_app.config.get("RESEND_API_KEY")
        and current_app.config.get("RESEND_FROM_EMAIL")
    )


# ===================================================
# SMS BODY BUILDER
# ===================================================

def _build_sms_body(payload):
    """
    Build SMS message text for appointment updates.
    """
    appointment_day = payload.get("appointment_day")
    appointment_day_text = f"{appointment_day}, " if appointment_day else ""

    doctor_name = _format_doctor_name(payload.get("doctor_name"))

    return (
        f"Your appointment with Dr. {doctor_name} on "
        f"{appointment_day_text}{payload['appointment_date']} at {payload['appointment_time']} "
        f"is currently {payload['status']}."
    )


# ===================================================
# EMAIL NOTIFICATION SENDER
# ===================================================

def send_email_notification(payload):
    """
    Send appointment status notification via email.
    """

    if _is_resend_configured():
        resend_result = _send_resend_email(
            payload.get("patient_email"),
            _build_email_subject(),
            _build_email_body(payload),
            _build_email_html(payload)
        )
        if resend_result:
            current_app.logger.info(
                "EMAIL SENT VIA RESEND | appointment_status=%s | to=%s | patient=%s | doctor=%s | id=%s",
                payload["status"],
                payload["patient_email"],
                payload["patient_name"],
                payload["doctor_name"],
                resend_result.get("provider_id")
            )
            return {
                "channel": "email",
                "sent": True,
                "target": payload["patient_email"]
            }

        return {
            "channel": "email",
            "sent": False,
            "reason": "Resend email sending failed",
            "target": payload.get("patient_email")
        }

    # Get Flask-Mail extension instance
    mail = current_app.extensions.get("mail")

    # Get default sender email from config
    sender = current_app.config.get("MAIL_DEFAULT_SENDER")

    # Validate email configuration
    if not mail or not Message or not sender or not payload.get("patient_email"):
        return {"channel": "email", "sent": False, "reason": "Email not configured"}

    # Build email message
    message = Message(
        subject=_build_email_subject(),
        sender=sender,
        recipients=[payload["patient_email"]],
        body=_build_email_body(payload)
    )

    # Send email
    mail.send(message)

    # Log email sending
    current_app.logger.info(
        "EMAIL SENT | appointment_status=%s | to=%s | patient=%s | doctor=%s",
        payload["status"],
        payload["patient_email"],
        payload["patient_name"],
        payload["doctor_name"]
    )

    return {
        "channel": "email",
        "sent": True,
        "target": payload["patient_email"]
    }


def send_password_reset_email(recipient_email, reset_link):
    """
    Send a password reset email if email delivery is configured.
    """
    if _is_resend_configured():
        resend_result = _send_resend_email(
            recipient_email,
            _build_password_reset_subject(),
            _build_password_reset_body(reset_link),
            _build_password_reset_html(reset_link)
        )
        return bool(resend_result)

    mail = current_app.extensions.get("mail")
    sender = current_app.config.get("MAIL_DEFAULT_SENDER")

    if not mail or not Message or not sender or not recipient_email:
        return False

    message = Message(
        subject=_build_password_reset_subject(),
        sender=sender,
        recipients=[recipient_email],
        body=_build_password_reset_body(reset_link)
    )
    mail.send(message)
    return True


# ===================================================
# SMS NOTIFICATION SENDER
# ===================================================

def send_sms_notification(payload):
    """
    Send appointment notification via SMS using Twilio.
    """

    account_sid = current_app.config.get("TWILIO_ACCOUNT_SID")
    auth_token = current_app.config.get("TWILIO_AUTH_TOKEN")
    from_number = current_app.config.get("TWILIO_PHONE_NUMBER")
    status_callback_url = current_app.config.get("TWILIO_STATUS_CALLBACK_URL")

    # Normalize patient phone number
    to_number = _normalize_phone_number(payload.get("patient_phone"))

    current_app.logger.info(
        "SMS CONFIG CHECK | sid_present=%s | token_present=%s | from_present=%s | callback_present=%s | raw_phone=%s | normalized_phone=%s",
        bool(account_sid),
        bool(auth_token),
        bool(from_number),
        bool(status_callback_url),
        str(payload.get("patient_phone") or ""),
        to_number
    )

    # Validate Twilio configuration
    if not Client or not account_sid or not auth_token or not from_number:
        return {"channel": "sms", "sent": False, "reason": "SMS not configured"}

    if not to_number:
        return {
            "channel": "sms",
            "sent": False,
            "reason": "Patient phone number missing",
            "target": str(payload.get("patient_phone") or "")
        }

    if not to_number.startswith("+"):
        return {
            "channel": "sms",
            "sent": False,
            "reason": "Patient phone number must include country code",
            "target": to_number
        }

    # Create Twilio client
    client = Client(account_sid, auth_token)

    # Build message parameters
    create_kwargs = {
        "body": _build_sms_body(payload),
        "from_": from_number,
        "to": to_number
    }

    current_app.logger.info(
        "SMS SEND ATTEMPT | from=%s | to=%s | patient=%s | doctor=%s | status=%s",
        from_number,
        to_number,
        payload["patient_name"],
        payload["doctor_name"],
        payload["status"]
    )

    # Add delivery callback URL if configured
    if status_callback_url:
        create_kwargs["status_callback"] = status_callback_url

    # Send SMS
    message = client.messages.create(**create_kwargs)

    # Log SMS sending
    current_app.logger.info(
        "SMS ACCEPTED | appointment_status=%s | from=%s | to=%s | patient=%s | doctor=%s | sid=%s | status=%s",
        payload["status"],
        from_number,
        to_number,
        payload["patient_name"],
        payload["doctor_name"],
        getattr(message, "sid", None),
        getattr(message, "status", None)
    )

    return {
        "channel": "sms",
        "sent": True,
        "delivery_state": "queued",
        "provider_status": getattr(message, "status", None),
        "target": to_number,
        "message_sid": getattr(message, "sid", None)
    }


# ===================================================
# SEND BOTH EMAIL AND SMS
# ===================================================

def send_status_notifications(payload):
    """
    Send both email and SMS notifications.
    """

    results = []

    for sender in (send_email_notification, send_sms_notification):
        try:
            results.append(sender(payload))
        except Exception as error:

            # Log failure
            current_app.logger.error(
                "%s FAILED | patient=%s | doctor=%s | reason=%s",
                "EMAIL" if sender is send_email_notification else "SMS",
                payload["patient_name"],
                payload["doctor_name"],
                str(error)
            )

            results.append({
                "channel": "email" if sender is send_email_notification else "sms",
                "sent": False,
                "reason": str(error)
            })

    return results


# ===================================================
# INITIAL DELIVERY STATE BUILDERS
# ===================================================

def _is_email_configured(payload):
    """Return True when email can be attempted for this payload."""
    mail = current_app.extensions.get("mail")
    sender = current_app.config.get("MAIL_DEFAULT_SENDER")
    return bool(mail and Message and sender and payload.get("patient_email"))


def _get_sms_validation_error(payload):
    """Return the SMS blocking reason when the payload cannot be sent."""
    account_sid = current_app.config.get("TWILIO_ACCOUNT_SID")
    auth_token = current_app.config.get("TWILIO_AUTH_TOKEN")
    from_number = current_app.config.get("TWILIO_PHONE_NUMBER")
    to_number = _normalize_phone_number(payload.get("patient_phone"))

    if not Client or not account_sid or not auth_token or not from_number:
        return "SMS not configured", to_number

    if not to_number:
        return "Patient phone number missing", str(payload.get("patient_phone") or "")

    if not to_number.startswith("+"):
        return "Patient phone number must include country code", to_number

    return None, to_number


def _build_initial_notification_results(payload):
    """Build the immediate notification state returned to the dashboard."""
    results = []

    if _is_email_configured(payload):
        results.append({
            "channel": "email",
            "sent": True,
            "delivery_state": "queued",
            "reason": "Email queued for delivery",
            "target": payload.get("patient_email")
        })
    else:
        results.append({
            "channel": "email",
            "sent": False,
            "reason": "Email not configured",
            "target": payload.get("patient_email")
        })

    sms_error, sms_target = _get_sms_validation_error(payload)
    if sms_error:
        results.append({
            "channel": "sms",
            "sent": False,
            "reason": sms_error,
            "target": sms_target
        })
    else:
        results.append({
            "channel": "sms",
            "sent": True,
            "delivery_state": "queued",
            "reason": "SMS queued for delivery",
            "target": sms_target
        })

    return results


# ===================================================
# BACKGROUND NOTIFICATION EXECUTION
# ===================================================

def _run_status_notifications(app_obj, appointment_id, payload):
    """Execute notifications in the background and persist their final state."""
    from models import (
        mark_appointment_notification_sent,
        save_appointment_notification_details,
        save_appointment_sms_tracking
    )

    with app_obj.app_context():
        results = send_status_notifications(payload)
        save_appointment_notification_details(appointment_id, results)

        for item in results:
            if item.get("channel") != "sms":
                continue

            message_sid = item.get("message_sid")
            if not message_sid:
                continue

            save_appointment_sms_tracking(
                appointment_id,
                message_sid,
                item.get("provider_status") or item.get("delivery_state"),
                item.get("target")
            )

        if any(item.get("sent") for item in results):
            mark_appointment_notification_sent(appointment_id, payload["status"])

def enqueue_status_notifications(appointment_id, payload):
    """
    Queue notifications to be sent asynchronously.
    """

    from models import save_appointment_notification_details

    # Save initial notification state
    initial_results = _build_initial_notification_results(payload)
    save_appointment_notification_details(appointment_id, initial_results)

    # Get current Flask app instance
    app_obj = current_app._get_current_object()

    # Execute notification sending in background thread
    _notification_executor.submit(
        _run_status_notifications,
        app_obj,
        appointment_id,
        payload
    )

    return initial_results
