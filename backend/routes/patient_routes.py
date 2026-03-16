# ===================================================
# PATIENT ROUTES BLUEPRINT
# ===================================================

# Flask utilities used to define routes and handle requests/responses
from flask import Blueprint, request, jsonify

# Database access functions related to patients, doctors and medical records
from models import (
    get_all_patients,                     # Retrieve all patients
    get_patient_by_id,                    # Retrieve a patient by ID
    get_doctor_by_id,                     # Retrieve a doctor by ID
    doctor_email_exists,                  # Check if doctor email already exists
    update_doctor_profile,                # Update doctor profile information
    add_patient,                          # Create a new patient
    delete_patient,                       # Delete a patient
    update_patient,                       # Update patient data
    patient_email_exists,                 # Check if patient email already exists
    get_patient_medical_records,          # Retrieve all medical records for a patient
    get_patient_medical_record_by_id      # Retrieve a specific medical record
)

# Authentication middleware that validates JWT tokens
from auth_middleware import token_required
from auth_middleware import admin_required

# Create Flask Blueprint to group patient-related routes
patient_bp = Blueprint("patient_bp", __name__)


# ===================================================
# GET ALL PATIENTS
# ===================================================

# Endpoint to retrieve all patients
# Typically used by admin management tools
@patient_bp.route("/patients", methods=["GET"])
@admin_required
def patients():
    """Return the full patient list. Used mainly by admin tools."""

    data = get_all_patients()
    return jsonify(data)


# ===================================================
# GET PATIENT BY ID
# ===================================================

# Endpoint to retrieve a specific patient by ID
@patient_bp.route("/patients/<int:patient_id>", methods=["GET"])
@admin_required
def get_patient(patient_id):
    """Return one patient by id."""

    patient = get_patient_by_id(patient_id)

    if patient:
        return jsonify(patient)

    return jsonify({"error": "Patient not found"}), 404


# ===================================================
# CREATE PATIENT
# ===================================================

# Public endpoint used to register a new patient account
@patient_bp.route("/patients", methods=["POST"])
def create_patient():
    """Register a new patient account from the public registration page."""

    try:
        data = request.get_json()

        # Ensure request body exists
        if not data:
            return jsonify({"error": "Request body missing"}), 400

        # Extract patient information
        full_name = data.get("full_name", "").strip()
        email = data.get("email", "").strip()
        password = data.get("password", "")
        phone = data.get("phone", "").strip()

        # Validate required fields
        if not full_name or not email or not password or not phone:
            return jsonify({"error": "All patient fields are required"}), 400

        # Prevent duplicate email registration
        if patient_email_exists(email):
            return jsonify({"error": "A patient with this email already exists"}), 400

        # Create the patient in the database
        add_patient(full_name, email, password, phone)

        return jsonify({"message": "Patient created successfully"}), 201

    except Exception as e:
        return jsonify({"error": "Unable to create patient right now"}), 500


# ---------------------------------------------------
# DELETE PATIENT (ADMIN ONLY)
# Prevent admin from deleting their own account
# ---------------------------------------------------

# Endpoint to delete a patient account
@patient_bp.route("/patients/<int:patient_id>", methods=["DELETE"])
@token_required
def remove_patient(current_patient_id, current_role, patient_id):
    """Delete a patient account. Admins cannot delete themselves."""

    # Only admins are allowed to delete patients
    if current_role != "admin":
        return jsonify({"error": "Admin access required"}), 403

    # Prevent admin from deleting their own account
    if current_patient_id == patient_id:
        return jsonify({"error": "Admin cannot delete their own account"}), 400

    patient = get_patient_by_id(patient_id)

    if patient:
        delete_patient(patient_id)
        return jsonify({"message": "Patient deleted successfully"})

    return jsonify({"error": "Patient not found"}), 404


# ---------------------------------------------------
# UPDATE PATIENT
# Admin can update anyone
# Patient can update their own profile
# ---------------------------------------------------

# Endpoint used to update patient information
@patient_bp.route("/patients/<int:patient_id>", methods=["PUT"])
@token_required
def edit_patient(current_patient_id, current_role, patient_id):
    """Update a patient profile from admin tools or self-service profile editing."""

    # Only admin or the patient themselves can update the profile
    if current_role != "admin" and current_patient_id != patient_id:
        return jsonify({"error": "Unauthorized"}), 403

    patient = get_patient_by_id(patient_id)

    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    data = request.get_json()

    email = data.get("email", "").strip()

    # Check for duplicate email
    if patient_email_exists(email, patient_id):
        return jsonify({"error": "A patient with this email already exists"}), 400

    # Update patient data
    update_patient(
        patient_id,
        data["full_name"],
        data["email"],
        data.get("password"),
        data["phone"]
    )

    return jsonify({"message": "Patient updated successfully"})


# ---------------------------------------------------
# PROFILE ROUTE
# ---------------------------------------------------

# Endpoint that returns the profile of the currently authenticated user
@patient_bp.route("/profile", methods=["GET"])
@token_required
def profile(current_patient_id, current_role):
    """Return the currently authenticated profile for patient/admin or doctor."""

    # If the user is a doctor
    if current_role == "doctor":

        doctor = get_doctor_by_id(current_patient_id)

        if not doctor:
            return jsonify({"error": "Doctor not found"}), 404

        return jsonify({
            "id": doctor["id"],
            "full_name": doctor["full_name"],
            "email": doctor["email"],
            "specialty": doctor["specialty"],
            "role": current_role
        })

    # Otherwise the user is a patient/admin
    patient = get_patient_by_id(current_patient_id)

    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    return jsonify({
        "id": patient["id"],
        "full_name": patient["full_name"],
        "email": patient["email"],
        "phone": patient["phone"],
        "role": current_role
    })


# ===================================================
# UPDATE PROFILE
# ===================================================

# Endpoint used to update the logged-in user's profile
@patient_bp.route("/profile", methods=["PUT"])
@token_required
def update_profile(current_user_id, current_role):
    """Update the profile fields for the currently authenticated user."""

    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body missing"}), 400

    full_name = data.get("full_name", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "")

    # ---------------------------------------------------
    # DOCTOR PROFILE UPDATE
    # ---------------------------------------------------
    if current_role == "doctor":

        specialty = data.get("specialty", "").strip()

        if not full_name or not email or not specialty:
            return jsonify({"error": "Full name, email and specialty are required"}), 400

        if doctor_email_exists(email, current_user_id):
            return jsonify({"error": "A doctor with this email already exists"}), 400

        update_doctor_profile(current_user_id, full_name, email, specialty, password or None)

        return jsonify({"message": "Doctor profile updated successfully"}), 200


    # ---------------------------------------------------
    # PATIENT PROFILE UPDATE
    # ---------------------------------------------------
    phone = data.get("phone", "").strip()

    if not full_name or not email or not phone:
        return jsonify({"error": "Full name, email and phone are required"}), 400

    if patient_email_exists(email, current_user_id):
        return jsonify({"error": "A patient with this email already exists"}), 400

    update_patient(current_user_id, full_name, email, password or None, phone)

    return jsonify({"message": "Profile updated successfully"}), 200


# ===================================================
# GET MEDICAL RECORDS
# ===================================================

# Endpoint used by patients to view their medical history
@patient_bp.route("/medical-records", methods=["GET"])
@token_required
def medical_records(current_patient_id, current_role):
    """Return all medical records that belong to the authenticated patient."""

    if current_role != "patient":
        return jsonify({"error": "Patient access required"}), 403

    records = get_patient_medical_records(current_patient_id)

    # Format date values for JSON response
    for record in records:
        record["created_at"] = record["created_at"].strftime("%Y-%m-%d")

    return jsonify(records)


# ===================================================
# GET MEDICAL RECORD DETAIL
# ===================================================

# Endpoint to retrieve one specific medical record
@patient_bp.route("/medical-records/<int:record_id>", methods=["GET"])
@token_required
def medical_record_detail(current_patient_id, current_role, record_id):
    """Return one medical record in detail for preview and download."""

    if current_role != "patient":
        return jsonify({"error": "Patient access required"}), 403

    record = get_patient_medical_record_by_id(current_patient_id, record_id)

    if not record:
        return jsonify({"error": "Medical record not found"}), 404

    # Format date/time fields for JSON response
    if record.get("created_at"):
        record["created_at"] = record["created_at"].strftime("%Y-%m-%d")

    if record.get("appointment_date"):
        record["appointment_date"] = record["appointment_date"].strftime("%Y-%m-%d")

    if record.get("appointment_time"):
        record["appointment_time"] = str(record["appointment_time"])

    return jsonify(record)


# ===================================================
# PROTECTED TEST ROUTE
# This route is accessible only with a valid JWT token
# ===================================================

@patient_bp.route("/protected", methods=["GET"])
@token_required
def protected(current_user_id, current_role):
    """Small test endpoint to demonstrate a route protected by JWT."""

    return jsonify({
        "message": "Access granted",
        "patient_id": current_user_id,
        "role": current_role
    })
