# ===================================================
# IMPORTS
# ===================================================

# Flask utilities used to create API routes and handle JSON responses/requests
from flask import Blueprint, jsonify, request, current_app

# Database-related functions used to manage appointments
from models import (
    create_appointment,                     # Create a new appointment
    get_patient_appointments,               # Get appointments for a specific patient
    delete_appointment,                     # Delete an appointment
    update_appointment_status_db,           # Update appointment status in the database
    get_all_appointments_from_db,           # Retrieve all appointments
    get_doctor_appointments,                # Retrieve appointments assigned to a doctor
    get_appointment_by_id,                  # Retrieve a specific appointment
    get_doctor_available_slots,             # Retrieve available appointment slots for a doctor
    get_appointment_notification_details,   # Get data needed to send notifications
    sync_medical_record_for_appointment,    # Automatically create/update a medical record after approval
    update_appointment_sms_delivery_status  # Update SMS delivery status from Twilio webhook
)

# Middleware used to verify JWT authentication tokens
from auth_middleware import token_required

# Notification service that queues email/SMS notifications
from notification_service import enqueue_status_notifications


# Create a Flask Blueprint to group all appointment-related routes
appointment_bp = Blueprint("appointment_bp", __name__)


# ===================================================
# CREATE APPOINTMENT (PATIENT ONLY)
# ===================================================

# Endpoint to create a new appointment
@appointment_bp.route("/appointments", methods=["POST"])
@token_required  # Ensures the request contains a valid authentication token
def create_new_appointment(current_user_id, current_role):
    """Create a new pending appointment for the authenticated patient."""

    # Only users with the role "patient" are allowed to create appointments
    if current_role != "patient":
        return jsonify({"error": "Only patients can create appointments"}), 403

    # Get request body data
    data = request.get_json()

    try:
        # Create the appointment in the database
        appointment_id = create_appointment(
            current_user_id,  # patient_id extracted from JWT token
            data["doctor_id"],
            data["appointment_date"],
            data["appointment_time"]
        )

        details = get_appointment_notification_details(appointment_id)
        notifications = []
        if details:
            notifications = enqueue_status_notifications(appointment_id, {
                "status": "PENDING",
                "appointment_day": details["appointment_date"].strftime("%A"),
                "appointment_date": details["appointment_date"].strftime("%Y-%m-%d"),
                "appointment_time": str(details["appointment_time"]),
                "patient_name": details["patient_name"],
                "patient_email": details.get("patient_email"),
                "patient_phone": details.get("patient_phone"),
                "doctor_name": details["doctor_name"]
            })

        return jsonify({
            "message": "Appointment created successfully",
            "notifications": notifications
        })

    # Handle any errors during appointment creation
    except Exception as e:
        current_app.logger.exception("Creating appointment failed: %s", str(e))
        return jsonify({"error": "Unable to create appointment"}), 400


# ===================================================
# GET PATIENT APPOINTMENTS (PATIENT ONLY)
# ===================================================

# Endpoint to retrieve all appointments for the authenticated patient
@appointment_bp.route("/appointments", methods=["GET"])
@token_required
def get_appointments(current_user_id, current_role):
    """Return the appointment list visible to the authenticated patient."""

    # Ensure the user is a patient
    if current_role != "patient":
        return jsonify({"error": "Only patients can view appointments"}), 403

    # Retrieve appointments from the database
    appointments = get_patient_appointments(current_user_id)

    # Format date and time for JSON response
    for appointment in appointments:
        appointment["appointment_date"] = appointment["appointment_date"].strftime("%Y-%m-%d")
        appointment["appointment_time"] = str(appointment["appointment_time"])

    return jsonify(appointments)


# ===================================================
# DELETE APPOINTMENT
# Admin → can delete any
# Patient → can delete only his own
# ===================================================

# Endpoint to delete an appointment
@appointment_bp.route("/appointments/<int:appointment_id>", methods=["DELETE"])
@token_required
def remove_appointment(current_user_id, current_role, appointment_id):
    """Delete an appointment with role-based ownership checks."""

    appointment = get_appointment_by_id(appointment_id)
    if not appointment:
        return jsonify({"error": "Appointment not found"}), 404

    # Admin users can delete any appointment
    if current_role == "admin":
        delete_appointment(appointment_id)
        return jsonify({"message": "Appointment deleted successfully"})

    # Patients can only delete their own appointments
    if current_role == "patient":
        if appointment["patient_id"] != current_user_id:
            return jsonify({"error": "Unauthorized"}), 403

        if appointment["status"] != "PENDING":
            return jsonify({"error": "Only pending appointments can be deleted"}), 400

        delete_appointment(appointment_id)
        return jsonify({"message": "Appointment deleted successfully"})

    # If user is not authorized
    return jsonify({"error": "Unauthorized"}), 403


# ===================================================
# UPDATE STATUS
# Admin → update any
# Doctor → update only his own appointments
# ===================================================

# Endpoint to update appointment status (approve or reject)
@appointment_bp.route("/appointments/<int:appointment_id>/status", methods=["PUT"])
@token_required
def update_appointment_status(current_user_id, current_role, appointment_id):
    """Approve or reject a pending appointment from doctor/admin workflows."""

    # Get request data
    data = request.get_json()
    new_status = data.get("status")

    # Validate status value
    if new_status not in ["APPROVED", "REJECTED"]:
        return jsonify({"error": "Invalid status value"}), 400

    # Retrieve the appointment from database
    appointment = get_appointment_by_id(appointment_id)

    # Check if appointment exists
    if not appointment:
        return jsonify({"error": "Appointment not found"}), 404

    # Prevent updating if status is already the same
    if appointment["status"] == new_status:
        return jsonify({"message": "Appointment already has this status"}), 200

    # Only pending appointments can be updated
    if appointment["status"] != "PENDING":
        return jsonify({"error": "Only pending appointments can change status"}), 400

    # Admin can update any appointment
    if current_role == "admin":
        update_appointment_status_db(appointment_id, new_status)
        return _finalize_status_update(appointment_id, new_status)

    # Doctor can update only appointments assigned to them
    if current_role == "doctor":
        if appointment["doctor_id"] != current_user_id:
            return jsonify({"error": "Unauthorized"}), 403

        update_appointment_status_db(appointment_id, new_status)
        return _finalize_status_update(appointment_id, new_status)

    return jsonify({"error": "Access denied"}), 403


def _finalize_status_update(appointment_id, new_status):
    """Trigger side effects after a successful status change."""

    # Retrieve notification details for this appointment
    details = get_appointment_notification_details(appointment_id)
    notifications = []

    # If appointment is approved, immediately create a medical record
    if new_status == "APPROVED":
        sync_medical_record_for_appointment(appointment_id)

    # Send notifications only if the status hasn't been notified before
    if details and details.get("status_notified_value") != new_status:
        notifications = enqueue_status_notifications(appointment_id, {
            "status": new_status,
            "appointment_day": details["appointment_date"].strftime("%A"),
            "appointment_date": details["appointment_date"].strftime("%Y-%m-%d"),
            "appointment_time": str(details["appointment_time"]),
            "patient_name": details["patient_name"],
            "patient_email": details.get("patient_email"),
            "patient_phone": details.get("patient_phone"),
            "doctor_name": details["doctor_name"]
        })

    return jsonify({
        "message": "Appointment status updated successfully",
        "notifications": notifications
    })


# ===================================================
# GET ALL APPOINTMENTS (ADMIN ONLY)
# ===================================================

# Endpoint for admin dashboard to retrieve all appointments
@appointment_bp.route("/admin/appointments", methods=["GET"])
@token_required
def get_all_appointments(current_user_id, current_role):
    """Return the global appointment list for the admin dashboard."""

    # Only admins are allowed to access this endpoint
    if current_role != "admin":
        return jsonify({"error": "Admin access required"}), 403

    appointments = get_all_appointments_from_db()

    # Format date/time values for JSON output
    for appointment in appointments:
        appointment["appointment_date"] = appointment["appointment_date"].strftime("%Y-%m-%d")
        appointment["appointment_time"] = str(appointment["appointment_time"])

    return jsonify(appointments)


# ===================================================
# GET APPOINTMENT STATS
# ===================================================

# Endpoint to return appointment statistics depending on the user role
@appointment_bp.route("/appointments/stats", methods=["GET"])
@token_required
def get_stats(current_user_id, current_role):
    """Return role-specific appointment statistics for dashboard cards."""

    # Local import to avoid circular dependencies
    from models import (
        get_appointment_stats,
        get_doctor_appointment_stats
    )

    # Admin → system-wide statistics
    if current_role == "admin":
        stats = get_appointment_stats()

    # Doctor → statistics for their own appointments
    elif current_role == "doctor":
        stats = get_doctor_appointment_stats(current_user_id)

    # Patient → statistics for their personal appointments
    else:
        stats = get_appointment_stats(current_user_id)

    return jsonify(stats)


# ===================================================
# GET DOCTOR APPOINTMENTS (DOCTOR ONLY)
# ===================================================

# Endpoint to retrieve appointments assigned to the logged-in doctor
@appointment_bp.route("/doctor/appointments", methods=["GET"])
@token_required
def get_doctor_appointments_route(current_user_id, current_role):
    """Return the appointment queue assigned to the logged-in doctor."""

    # Ensure only doctors can access this route
    if current_role != "doctor":
        return jsonify({"error": "Doctor access required"}), 403

    appointments = get_doctor_appointments(current_user_id)

    # Format date/time for JSON output
    for appointment in appointments:
        appointment["appointment_date"] = appointment["appointment_date"].strftime("%Y-%m-%d")
        appointment["appointment_time"] = str(appointment["appointment_time"])

    return jsonify(appointments)


# Endpoint to retrieve available appointment slots for a doctor
@appointment_bp.route("/doctors/<int:doctor_id>/available-slots", methods=["GET"])
@token_required
def get_doctor_slots(current_user_id, current_role, doctor_id):
    """Return only the available slots generated from doctor availability."""

    # Ensure the user has one of the allowed roles
    if current_role not in ["patient", "doctor", "admin"]:
        return jsonify({"error": "Unauthorized"}), 403

    slots = get_doctor_available_slots(doctor_id)
    return jsonify(slots)


# ===================================================
# TWILIO SMS STATUS WEBHOOK
# ===================================================

# Webhook endpoint used by Twilio to send SMS delivery updates
@appointment_bp.route("/webhooks/twilio/sms-status", methods=["POST"])
def handle_twilio_sms_status():
    """Receive Twilio delivery updates and persist the latest SMS state."""

    # Extract message ID and status from Twilio request
    message_sid = (request.form.get("MessageSid") or "").strip()
    message_status = (request.form.get("MessageStatus") or "").strip()

    # Validate required parameters
    if not message_sid or not message_status:
        return jsonify({"error": "Missing MessageSid or MessageStatus"}), 400

    # Update SMS delivery status in the database
    updated = update_appointment_sms_delivery_status(
        message_sid,
        message_status,
        request.form.to_dict(flat=True)
    )

    # If the message is not linked to an appointment
    if not updated:
        return jsonify({"message": "Message SID not linked to an appointment"}), 202

    return jsonify({"message": "SMS delivery status updated"}), 200
