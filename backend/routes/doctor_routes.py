# ===================================================
# IMPORTS
# ===================================================

# Flask utilities used to create API routes and handle JSON requests/responses
from flask import Blueprint, jsonify, request, current_app

# Database functions used for doctor management and related data
from models import (
    get_db_connection,               # Create a connection to the database
    get_doctor_availability,         # Retrieve doctor's availability schedule
    update_doctor_availability,      # Update doctor's availability schedule
    delete_doctor_and_related_data,  # Delete doctor and related records
    get_doctor_patients,             # Retrieve patients linked to a doctor
    get_doctor_reports,              # Retrieve analytics/reports for a doctor
    doctor_email_exists              # Check if a doctor email is already used
)

# Middleware used for authentication and role-based access control
from auth_middleware import admin_required
from auth_middleware import token_required

# Bcrypt library used for secure password hashing
import bcrypt


# ===================================================
# BLUEPRINT INITIALIZATION
# ===================================================

# Create a Flask Blueprint to group all doctor-related routes
doctor_routes = Blueprint("doctor_routes", __name__)


# ===================================================
# GET ALL DOCTORS (PUBLIC)
# ===================================================

# Public endpoint that returns a list of doctors
# Used by patients when selecting a doctor during appointment booking
@doctor_routes.route("/doctors", methods=["GET"])
def get_doctors():
    """Public endpoint used by patients to choose a doctor for booking."""

    try:
        # Open database connection
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Retrieve doctor basic information
        cursor.execute("SELECT id, full_name, specialty FROM doctors")
        doctors = cursor.fetchall()

        # Close database resources
        cursor.close()
        conn.close()

        # Return doctor list
        return jsonify(doctors), 200

    except Exception as e:
        current_app.logger.exception("Loading public doctors failed: %s", str(e))
        return jsonify({"error": "Unable to load doctors right now"}), 500


# ===================================================
# GET DOCTORS (ADMIN VIEW)
# ===================================================

# Admin-only endpoint that includes additional information (email)
# Used in the admin dashboard for doctor management
@doctor_routes.route("/admin/doctors", methods=["GET"])
@admin_required
def get_doctors_admin():
    """Admin-only doctor list with email included for management screens."""

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Retrieve full doctor information for admin panel
        cursor.execute("SELECT id, full_name, specialty, email FROM doctors")
        doctors = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify(doctors), 200

    except Exception as e:
        current_app.logger.exception("Loading admin doctors failed: %s", str(e))
        return jsonify({"error": "Unable to load doctors right now"}), 500


# ===================================================
# ADD NEW DOCTOR (ADMIN ONLY)
# ===================================================

# Endpoint used by administrators to create new doctor accounts
@doctor_routes.route("/admin/doctors", methods=["POST"])
@admin_required
def add_doctor():
    """Create a new doctor account from the admin dashboard."""

    try:
        # Read JSON request body
        data = request.get_json()

        # Extract doctor information
        full_name = data["full_name"]
        specialty = data["specialty"]
        email = data["email"]
        password = data["password"]

        if doctor_email_exists(email):
            return jsonify({"error": "A doctor with this email already exists"}), 400

        # Hash the password using bcrypt before storing it in the database
        hashed_password = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt()
        ).decode("utf-8")

        # Insert new doctor record into the database
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO doctors (full_name, specialty, email, password)
            VALUES (%s, %s, %s, %s)
        """, (full_name, specialty, email, hashed_password))

        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({"message": "Doctor added successfully"}), 201

    except Exception as e:
        current_app.logger.exception("Adding doctor failed: %s", str(e))
        return jsonify({"error": "Unable to add doctor right now"}), 500


# ===================================================
# DELETE DOCTOR (ADMIN ONLY)
# ===================================================

# Endpoint that allows administrators to delete a doctor
# Also removes related data such as appointments and availability
@doctor_routes.route("/admin/doctors/<int:doctor_id>", methods=["DELETE"])
@admin_required
def delete_doctor(doctor_id):
    """Delete a doctor and the related appointments/availability rows."""

    try:
        # Call model function that handles cascading deletion
        delete_doctor_and_related_data(doctor_id)

        return jsonify({"message": "Doctor deleted successfully"}), 200

    except Exception as e:
        current_app.logger.exception("Deleting doctor failed: %s", str(e))
        return jsonify({"error": "Unable to delete doctor right now"}), 500


# ===================================================
# UPDATE DOCTOR (ADMIN ONLY)
# ===================================================

# Endpoint used by admins to update doctor information
@doctor_routes.route("/admin/doctors/<int:doctor_id>", methods=["PUT"])
@admin_required
def update_doctor(doctor_id):
    """Update doctor identity fields from admin tools."""

    try:
        # Read request body
        data = request.get_json()

        conn = get_db_connection()
        cursor = conn.cursor()

        if doctor_email_exists(data["email"], doctor_id):
            cursor.close()
            conn.close()
            return jsonify({"error": "A doctor with this email already exists"}), 400

        # Update doctor fields
        cursor.execute("""
            UPDATE doctors
            SET full_name = %s,
                specialty = %s,
                email = %s
            WHERE id = %s
        """, (
            data["full_name"],
            data["specialty"],
            data["email"],
            doctor_id
        ))

        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({"message": "Doctor updated successfully"}), 200

    except Exception as e:
        current_app.logger.exception("Updating doctor failed: %s", str(e))
        return jsonify({"error": "Unable to update doctor right now"}), 500


# ===================================================
# GET DOCTOR AVAILABILITY
# ===================================================

# Endpoint used by doctors to view their weekly availability schedule
@doctor_routes.route("/doctor/availability", methods=["GET"])
@token_required
def get_my_availability(current_user_id, current_role):
    """Return the logged-in doctor's weekly availability configuration."""

    # Ensure the authenticated user is a doctor
    if current_role != "doctor":
        return jsonify({"error": "Doctor access required"}), 403

    # Retrieve availability from database
    return jsonify(get_doctor_availability(current_user_id)), 200


# ===================================================
# UPDATE DOCTOR AVAILABILITY
# ===================================================

# Endpoint used by doctors to update their working schedule
@doctor_routes.route("/doctor/availability", methods=["PUT"])
@token_required
def update_my_availability(current_user_id, current_role):
    """Persist the doctor's weekly working schedule."""

    if current_role != "doctor":
        return jsonify({"error": "Doctor access required"}), 403

    # Read availability data
    data = request.get_json()
    availability = data.get("availability", []) if data else []

    # Ensure availability data is provided
    if not availability:
        return jsonify({"error": "Availability data is required"}), 400

    # Update schedule in database
    update_doctor_availability(current_user_id, availability)

    return jsonify({"message": "Availability updated successfully"}), 200


# ===================================================
# GET DOCTOR PATIENTS
# ===================================================

# Endpoint used by doctors to view patients they have treated
@doctor_routes.route("/doctor/patients", methods=["GET"])
@token_required
def get_my_patients(current_user_id, current_role):
    """Return the patients linked to the doctor through appointment history."""

    if current_role != "doctor":
        return jsonify({"error": "Doctor access required"}), 403

    # Optional search parameter to filter patients
    search_query = request.args.get("search", "").strip() or None

    # Retrieve patient list
    patients = get_doctor_patients(current_user_id, search_query)

    # Format last visit date for JSON response
    for patient in patients:
        if patient["last_visit"]:
            patient["last_visit"] = patient["last_visit"].strftime("%Y-%m-%d")

    return jsonify(patients), 200


# ===================================================
# GET DOCTOR REPORTS / ANALYTICS
# ===================================================

# Endpoint used in the doctor dashboard to display statistics
@doctor_routes.route("/doctor/reports", methods=["GET"])
@token_required
def get_my_reports(current_user_id, current_role):
    """Return doctor analytics used in the reports section of the dashboard."""

    if current_role != "doctor":
        return jsonify({"error": "Doctor access required"}), 403

    # Retrieve analytics data
    return jsonify(get_doctor_reports(current_user_id)), 200
