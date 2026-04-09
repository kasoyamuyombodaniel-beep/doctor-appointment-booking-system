# Import Flask utilities to create routes and handle requests/responses
from flask import Blueprint, request, jsonify, current_app

# JWT library used to generate authentication tokens
import jwt

# Datetime library used to define token expiration time
import datetime

# Bcrypt library used for password hashing and verification
import bcrypt

# Database access functions
from models import (
    get_patient_by_email,
    get_doctor_by_email,
    reset_user_password,
    create_password_reset_token,
    consume_password_reset_token,
)
from notification_service import send_password_reset_email


# Create a Flask Blueprint to group authentication routes
auth_bp = Blueprint("auth_bp", __name__)


def _normalize_stored_password_hash(raw_value):
    """
    Normalize stored password hashes.

    Some old password hashes may be stored as string representations
    of byte literals like:  b'$2b$12$....'
    This function converts them back into proper byte format
    so bcrypt can verify them correctly.
    """

    # If no value exists, return None
    if not raw_value:
        return None

    # If already stored as bytes, return as-is
    if isinstance(raw_value, bytes):
        return raw_value

    # Convert the value to string and remove spaces
    value = str(raw_value).strip()

    # Handle cases where the hash is stored like b'.....'
    if value.startswith("b'") and value.endswith("'"):
        value = value[2:-1]

    # Handle cases where the hash is stored like b"....."
    elif value.startswith('b"') and value.endswith('"'):
        value = value[2:-1]

    # Convert the cleaned string into bytes
    return value.encode("utf-8")


# ===================================================
# LOGIN ROUTE
# ===================================================

# API endpoint for user login
@auth_bp.route("/login", methods=["POST"])
def login():
    """Authenticate a user and return a JWT token for the selected role."""

    try:
        # Read login credentials from JSON request body
        data = request.get_json()

        # Check if request body exists
        if not data:
            return jsonify({"error": "Request body missing"}), 400

        # Extract login data
        requested_role = data.get("role")
        email = data.get("email")
        password = data.get("password")

        # Validate required fields
        if not requested_role or not email or not password:
            return jsonify({"error": "Role, email and password required"}), 400

        # Ensure the role is valid
        if requested_role not in ["patient", "doctor", "admin"]:
            return jsonify({"error": "Invalid role"}), 400

        # ---------------------------------------------------
        # PATIENT / ADMIN LOGIN
        # ---------------------------------------------------
        # Patients and admins are stored in the same table
        # and distinguished by the "role" column.
        if requested_role in ["patient", "admin"]:

            # Retrieve user by email
            user = get_patient_by_email(email)

            # Normalize password hash from database
            stored_hash = _normalize_stored_password_hash(user.get("password")) if user else None

            # Verify user exists, role matches, and password hash exists
            if user and stored_hash and user.get("role") == requested_role:

                # Verify password using bcrypt
                if bcrypt.checkpw(
                    password.encode("utf-8"),
                    stored_hash
                ):

                    # Create a JWT token valid for 2 hours
                    token = jwt.encode(
                        {
                            "user_id": user["id"],          # user identifier
                            "role": user["role"],           # user role
                            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=2)  # expiration
                        },
                        current_app.config["SECRET_KEY"],   # secret key from Flask config
                        algorithm="HS256"
                    )

                    # Return token to client
                    return jsonify({"token": token}), 200


        # ---------------------------------------------------
        # DOCTOR LOGIN
        # ---------------------------------------------------
        # Doctors are stored in a separate table
        if requested_role == "doctor":

            # Retrieve doctor by email
            doctor = get_doctor_by_email(email)

            # Normalize stored password hash
            stored_hash = _normalize_stored_password_hash(doctor.get("password")) if doctor else None

            # Verify doctor exists and password hash exists
            if doctor and stored_hash:

                # Verify password
                if bcrypt.checkpw(
                    password.encode("utf-8"),
                    stored_hash
                ):

                    # Generate JWT token
                    token = jwt.encode(
                        {
                            "user_id": doctor["id"],
                            "role": "doctor",
                            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=2)
                        },
                        current_app.config["SECRET_KEY"],
                        algorithm="HS256"
                    )

                    return jsonify({"token": token}), 200


        # ---------------------------------------------------
        # INVALID CREDENTIALS
        # ---------------------------------------------------
        # If login fails for any reason
        return jsonify({"error": "Invalid credentials"}), 401

    # Catch unexpected server errors
    except Exception as e:
        current_app.logger.exception("Login failed: %s", str(e))
        return jsonify({"error": "Unable to process login right now"}), 500


# ===================================================
# FORGOT PASSWORD ROUTE
# ===================================================

@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    """
    Reset a user's password using their email address.

    Works for both patients and doctors.
    """

    try:
        # Get JSON request data
        data = request.get_json()

        # Ensure request body exists
        if not data:
            return jsonify({"error": "Request body missing"}), 400

        # Extract fields
        email = data.get("email", "").strip()

        # Validate required inputs
        if not email:
            return jsonify({"error": "Email is required"}), 400

        patient = get_patient_by_email(email)
        doctor = get_doctor_by_email(email)
        account_exists = bool(patient or doctor)

        if account_exists:
            token = create_password_reset_token(email)
            base_url = (current_app.config.get("FRONTEND_URL") or request.host_url.rstrip("/")).rstrip("/")
            if base_url.endswith(".html"):
                reset_link = f"{base_url}?token={token}"
            else:
                reset_link = f"{base_url}/reset-password.html?token={token}"

            email_sent = send_password_reset_email(email, reset_link)
            if not email_sent:
                current_app.logger.warning(
                    "Password reset requested for %s but email is not configured. Reset link: %s",
                    email,
                    reset_link
                )

        # Generic response avoids exposing whether the email exists.
        return jsonify({
            "message": "If the account exists, a password reset link has been generated"
        }), 200

    # Catch unexpected errors
    except Exception as e:
        current_app.logger.exception("Forgot-password failed: %s", str(e))
        return jsonify({"error": "Unable to start password reset right now"}), 500


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    """
    Complete a password reset using a one-time token.
    """

    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "Request body missing"}), 400

        token = str(data.get("token", "")).strip()
        new_password = data.get("new_password", "")

        if not token or not new_password:
            return jsonify({"error": "Token and new password are required"}), 400

        if len(new_password) < 8:
            return jsonify({"error": "Password must be at least 8 characters"}), 400

        email = consume_password_reset_token(token)
        if not email:
            return jsonify({"error": "Invalid or expired reset token"}), 400

        reset_user_password(email, new_password)
        return jsonify({"message": "Password updated successfully"}), 200

    except Exception as e:
        current_app.logger.exception("Reset-password failed: %s", str(e))
        return jsonify({"error": "Unable to reset password right now"}), 500
