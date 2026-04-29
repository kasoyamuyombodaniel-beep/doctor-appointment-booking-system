# ===================================================
# IMPORTS
# ===================================================
# Import required libraries:
import json  # json for storing notification results
import os  # os for environment variables
import hashlib
import secrets
from datetime import date, datetime, timedelta # datetime for date and time calculations
import mysql.connector  # mysql.connector for database communication
from mysql.connector import pooling

import bcrypt  # bcrypt for secure password hashing

DEFAULT_DOCTOR_AVAILABILITY = {
    0: ("09:00", "17:00"),
    1: ("09:00", "17:00"),
    2: ("09:00", "17:00"),
    3: ("09:00", "17:00"),
    4: ("09:00", "17:00"),
}
SLOT_INTERVAL_MINUTES = 60
_DB_POOL = None


# ===================================================
# DATABASE CONFIGURATION
# ===================================================

def _get_db_config():
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD"),
        "database": os.getenv("DB_NAME", "doctor_booking_db"),
    }


def _get_db_pool():
    """
    Reuse a small MySQL connection pool so request-heavy flows such as login
    do not pay the full connection setup cost every time.
    """
    global _DB_POOL

    if _DB_POOL is None:
        _DB_POOL = pooling.MySQLConnectionPool(
            pool_name=os.getenv("DB_POOL_NAME", "doctor_booking_pool"),
            pool_size=max(1, int(os.getenv("DB_POOL_SIZE", "5"))),
            pool_reset_session=True,
            **_get_db_config()
        )

    return _DB_POOL

def get_db_connection():
    """
    Create and return a new MySQL connection for the application.
    """
    try:
        conn = _get_db_pool().get_connection()
        if not conn.is_connected():
            conn.reconnect(attempts=1, delay=0)
        return conn
    except Exception:
        return mysql.connector.connect(**_get_db_config())


def ensure_password_reset_tokens_table():
    """Create the password reset token table if it does not exist yet."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_token_hash (token_hash),
            INDEX idx_password_reset_email (email),
            INDEX idx_password_reset_expires (expires_at)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()


def ensure_availability_table():
    """Create the doctor availability table if it does not exist yet."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS doctor_availability (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT NOT NULL,
            weekday TINYINT NOT NULL,
            start_time TIME NULL,
            end_time TIME NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            UNIQUE KEY unique_doctor_weekday (doctor_id, weekday)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()


def ensure_doctor_patient_profiles_table():
    """Create the helper table used by the doctor dashboard patient view."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS doctor_patient_profiles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            doctor_id INT NOT NULL,
            patient_id INT NOT NULL,
            age INT NULL,
            clinical_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
            notes TEXT NULL,
            UNIQUE KEY unique_doctor_patient (doctor_id, patient_id)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()


def ensure_medical_records_table():
    """Create the patient medical records table used by the records page."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS medical_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            patient_id INT NOT NULL,
            doctor_id INT NOT NULL,
            appointment_id INT NULL,
            document_name VARCHAR(255) NOT NULL,
            record_type VARCHAR(100) NOT NULL DEFAULT 'Consultation',
            file_size VARCHAR(50) NOT NULL DEFAULT '0.4 MB',
            created_at DATE NOT NULL,
            UNIQUE KEY unique_appointment_record (appointment_id)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()


def ensure_appointment_notification_columns():
    """Add notification tracking columns for databases created before this feature."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'status_notified_at'")
    has_notified_at = cursor.fetchone()
    if not has_notified_at:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN status_notified_at DATETIME NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'status_notified_value'")
    has_notified_value = cursor.fetchone()
    if not has_notified_value:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN status_notified_value VARCHAR(20) NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'notification_delivery_details'")
    has_delivery_details = cursor.fetchone()
    if not has_delivery_details:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN notification_delivery_details TEXT NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'patient_message_read_at'")
    has_patient_message_read_at = cursor.fetchone()
    if not has_patient_message_read_at:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN patient_message_read_at DATETIME NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'doctor_message_read_at'")
    has_doctor_message_read_at = cursor.fetchone()
    if not has_doctor_message_read_at:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN doctor_message_read_at DATETIME NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'sms_message_sid'")
    has_sms_message_sid = cursor.fetchone()
    if not has_sms_message_sid:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN sms_message_sid VARCHAR(64) NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'sms_delivery_status'")
    has_sms_delivery_status = cursor.fetchone()
    if not has_sms_delivery_status:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN sms_delivery_status VARCHAR(32) NULL
        """)

    cursor.execute("SHOW COLUMNS FROM appointments LIKE 'sms_delivery_updated_at'")
    has_sms_delivery_updated_at = cursor.fetchone()
    if not has_sms_delivery_updated_at:
        cursor.execute("""
            ALTER TABLE appointments
            ADD COLUMN sms_delivery_updated_at DATETIME NULL
        """)

    conn.commit()
    cursor.close()
    conn.close()


# ===================================================
# ================= PATIENT FUNCTIONS ==============
# ===================================================

def get_all_patients():
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, full_name, email, phone, role
        FROM patients
        WHERE role = 'patient'
    """)

    patients = cursor.fetchall()

    cursor.close()
    conn.close()
    return patients


def get_patient_by_id(patient_id):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, full_name, email, phone, role
        FROM patients
        WHERE id = %s
    """, (patient_id,))

    patient = cursor.fetchone()

    cursor.close()
    conn.close()
    return patient


def get_patient_by_email(email):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT *
        FROM patients
        WHERE email = %s
    """, (email,))

    patient = cursor.fetchone()

    cursor.close()
    conn.close()
    return patient


def add_patient(full_name, email, password, phone):
    conn = get_db_connection()
    cursor = conn.cursor()

    # Hash password before saving
    hashed_password = bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    )

    cursor.execute("""
        INSERT INTO patients
        (full_name, email, password, phone, role)
        VALUES (%s, %s, %s, %s, 'patient')
    """, (full_name, email, hashed_password.decode("utf-8"), phone))

    conn.commit()
    cursor.close()
    conn.close()


def update_patient(patient_id, full_name, email, password, phone):
    conn = get_db_connection()
    cursor = conn.cursor()

    if password:
        hashed_password = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt()
        )

        cursor.execute("""
            UPDATE patients
            SET full_name = %s,
                email = %s,
                password = %s,
                phone = %s
            WHERE id = %s
        """, (full_name, email, hashed_password.decode("utf-8"), phone, patient_id))
    else:
        cursor.execute("""
            UPDATE patients
            SET full_name = %s,
                email = %s,
                phone = %s
            WHERE id = %s
        """, (full_name, email, phone, patient_id))

    conn.commit()
    cursor.close()
    conn.close()


def delete_patient(patient_id):
    ensure_doctor_patient_profiles_table()
    ensure_medical_records_table()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        DELETE FROM medical_records
        WHERE patient_id = %s
    """, (patient_id,))

    cursor.execute("""
        DELETE FROM doctor_patient_profiles
        WHERE patient_id = %s
    """, (patient_id,))

    cursor.execute("""
        DELETE FROM appointments
        WHERE patient_id = %s
    """, (patient_id,))

    cursor.execute("""
        DELETE FROM patients
        WHERE id = %s
    """, (patient_id,))

    conn.commit()
    cursor.close()
    conn.close()


# ===================================================
# ================= DOCTOR FUNCTIONS ===============
# ===================================================

def get_doctor_by_email(email):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT *
        FROM doctors
        WHERE email = %s
    """, (email,))

    doctor = cursor.fetchone()

    cursor.close()
    conn.close()
    return doctor


def get_doctor_by_id(doctor_id):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, full_name, email, specialty
        FROM doctors
        WHERE id = %s
    """, (doctor_id,))

    doctor = cursor.fetchone()

    cursor.close()
    conn.close()
    return doctor


def doctor_email_exists(email, exclude_doctor_id=None):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    if exclude_doctor_id:
        cursor.execute("""
            SELECT id
            FROM doctors
            WHERE email = %s AND id != %s
        """, (email, exclude_doctor_id))
    else:
        cursor.execute("""
            SELECT id
            FROM doctors
            WHERE email = %s
        """, (email,))

    existing = cursor.fetchone()
    cursor.close()
    conn.close()
    return existing is not None


def _normalize_time_value(value):
    if hasattr(value, "strftime"):
        return value.strftime("%H:%M")

    if isinstance(value, timedelta):
        total_seconds = int(value.total_seconds())
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        return f"{hours:02d}:{minutes:02d}"

    value_str = str(value)
    if len(value_str) >= 5:
        return value_str[:5]

    return value_str


def _build_time_slots(start_time, end_time):
    slots = []
    current = datetime.strptime(start_time, "%H:%M")
    limit = datetime.strptime(end_time, "%H:%M")

    while current < limit:
        slots.append(current.strftime("%H:%M"))
        current += timedelta(minutes=SLOT_INTERVAL_MINUTES)

    return slots


def get_doctor_availability(doctor_id):
    ensure_availability_table()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT weekday, start_time, end_time, is_active
        FROM doctor_availability
        WHERE doctor_id = %s
        ORDER BY weekday
    """, (doctor_id,))

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    row_map = {
        row["weekday"]: {
            "weekday": row["weekday"],
            "start_time": _normalize_time_value(row["start_time"]) if row["start_time"] else None,
            "end_time": _normalize_time_value(row["end_time"]) if row["end_time"] else None,
            "is_active": bool(row["is_active"])
        }
        for row in rows
    }

    availability = []
    for weekday in range(7):
        if weekday in row_map:
            availability.append(row_map[weekday])
            continue

        if weekday in DEFAULT_DOCTOR_AVAILABILITY:
            start_time, end_time = DEFAULT_DOCTOR_AVAILABILITY[weekday]
            availability.append({
                "weekday": weekday,
                "start_time": start_time,
                "end_time": end_time,
                "is_active": True
            })
        else:
            availability.append({
                "weekday": weekday,
                "start_time": "09:00",
                "end_time": "17:00",
                "is_active": False
            })

    return availability


def update_doctor_availability(doctor_id, availability_rows):
    ensure_availability_table()

    conn = get_db_connection()
    cursor = conn.cursor()

    for row in availability_rows:
        weekday = int(row["weekday"])
        start_time = row.get("start_time")
        end_time = row.get("end_time")
        is_active = bool(row.get("is_active"))

        if is_active:
            if not start_time or not end_time:
                raise Exception("Start time and end time are required for active days")
            if _normalize_time_value(start_time) >= _normalize_time_value(end_time):
                raise Exception("Start time must be earlier than end time")

        cursor.execute("""
            INSERT INTO doctor_availability (doctor_id, weekday, start_time, end_time, is_active)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                start_time = VALUES(start_time),
                end_time = VALUES(end_time),
                is_active = VALUES(is_active)
        """, (doctor_id, weekday, start_time, end_time, is_active))

    conn.commit()
    cursor.close()
    conn.close()


def update_doctor_profile(doctor_id, full_name, email, specialty, password=None):
    conn = get_db_connection()
    cursor = conn.cursor()

    if password:
        hashed_password = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt()
        ).decode("utf-8")

        cursor.execute("""
            UPDATE doctors
            SET full_name = %s,
                email = %s,
                specialty = %s,
                password = %s
            WHERE id = %s
        """, (full_name, email, specialty, hashed_password, doctor_id))
    else:
        cursor.execute("""
            UPDATE doctors
            SET full_name = %s,
                email = %s,
                specialty = %s
            WHERE id = %s
        """, (full_name, email, specialty, doctor_id))

    conn.commit()
    cursor.close()
    conn.close()


def reset_user_password(email, new_password):
    hashed_password = bcrypt.hashpw(
        new_password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")

    patient = get_patient_by_email(email)
    if patient:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE patients
            SET password = %s
            WHERE email = %s
        """, (hashed_password, email))
        conn.commit()
        cursor.close()
        conn.close()
        return True

    doctor = get_doctor_by_email(email)
    if doctor:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE doctors
            SET password = %s
            WHERE email = %s
        """, (hashed_password, email))
        conn.commit()
        cursor.close()
        conn.close()
        return True

    return False


def create_password_reset_token(email, expires_in_minutes=30):
    """Create and persist a one-time password reset token."""
    ensure_password_reset_tokens_table()

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    expires_at = datetime.utcnow() + timedelta(minutes=max(int(expires_in_minutes), 1))

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE email = %s
          AND used_at IS NULL
          AND expires_at > NOW()
    """, (email,))

    cursor.execute("""
        INSERT INTO password_reset_tokens (email, token_hash, expires_at)
        VALUES (%s, %s, %s)
    """, (email, token_hash, expires_at))

    conn.commit()
    cursor.close()
    conn.close()
    return raw_token


def consume_password_reset_token(raw_token):
    """Validate and consume a password reset token, returning the target email."""
    ensure_password_reset_tokens_table()

    token_hash = hashlib.sha256(str(raw_token or "").encode("utf-8")).hexdigest()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, email
        FROM password_reset_tokens
        WHERE token_hash = %s
          AND used_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
    """, (token_hash,))
    token_row = cursor.fetchone()

    if not token_row:
        cursor.close()
        conn.close()
        return None

    write_cursor = conn.cursor()
    write_cursor.execute("""
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE id = %s
          AND used_at IS NULL
    """, (token_row["id"],))

    conn.commit()
    write_cursor.close()
    cursor.close()
    conn.close()
    return token_row["email"]


def patient_email_exists(email, exclude_patient_id=None):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    if exclude_patient_id:
        cursor.execute("""
            SELECT id
            FROM patients
            WHERE email = %s AND id != %s
        """, (email, exclude_patient_id))
    else:
        cursor.execute("""
            SELECT id
            FROM patients
            WHERE email = %s
        """, (email,))

    existing = cursor.fetchone()
    cursor.close()
    conn.close()
    return existing is not None


def _seed_doctor_patient_profiles(doctor_id):
    ensure_doctor_patient_profiles_table()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT DISTINCT patient_id
        FROM appointments
        WHERE doctor_id = %s
    """, (doctor_id,))

    patient_rows = cursor.fetchall()

    for index, row in enumerate(patient_rows):
        patient_id = row[0]
        cursor.execute("""
            INSERT INTO doctor_patient_profiles (doctor_id, patient_id, age, clinical_status, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                doctor_id = VALUES(doctor_id)
        """, (
            doctor_id,
            patient_id,
            24 + (index % 36),
            "In Treatment",
            "Auto-generated from appointment history"
        ))

    conn.commit()
    cursor.close()
    conn.close()


def seed_medical_records_for_patient(patient_id):
    """Create placeholder medical records from approved appointments."""
    ensure_medical_records_table()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            a.id,
            a.appointment_date,
            a.doctor_id,
            d.full_name AS doctor_name
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = %s
          AND a.status = 'APPROVED'
    """, (patient_id,))
    approved_appointments = cursor.fetchall()

    write_cursor = conn.cursor()
    for index, appointment in enumerate(approved_appointments, start=1):
        write_cursor.execute("""
            INSERT INTO medical_records (
                patient_id, doctor_id, appointment_id, document_name, record_type, file_size, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                document_name = VALUES(document_name),
                record_type = VALUES(record_type),
                file_size = VALUES(file_size),
                created_at = VALUES(created_at)
        """, (
            patient_id,
            appointment["doctor_id"],
            appointment["id"],
            f"Consultation Summary {index}",
            "PDF",
            f"{0.4 + ((index - 1) * 0.1):.1f} MB",
            appointment["appointment_date"]
        ))

    conn.commit()
    write_cursor.close()
    cursor.close()
    conn.close()


def sync_medical_record_for_appointment(appointment_id):
    """Insert or refresh one medical record as soon as an appointment is approved."""
    ensure_medical_records_table()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            a.id,
            a.patient_id,
            a.doctor_id,
            a.appointment_date,
            a.status
        FROM appointments a
        WHERE a.id = %s
    """, (appointment_id,))
    appointment = cursor.fetchone()

    if not appointment:
        cursor.close()
        conn.close()
        return

    write_cursor = conn.cursor()

    if appointment["status"] == "APPROVED":
        write_cursor.execute("""
            SELECT COUNT(*) AS existing_count
            FROM medical_records
            WHERE patient_id = %s
              AND appointment_id IS NOT NULL
        """, (appointment["patient_id"],))
        existing_count = write_cursor.fetchone()[0]
        document_index = existing_count + 1

        write_cursor.execute("""
            INSERT INTO medical_records (
                patient_id, doctor_id, appointment_id, document_name, record_type, file_size, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                doctor_id = VALUES(doctor_id),
                document_name = VALUES(document_name),
                record_type = VALUES(record_type),
                file_size = VALUES(file_size),
                created_at = VALUES(created_at)
        """, (
            appointment["patient_id"],
            appointment["doctor_id"],
            appointment["id"],
            f"Consultation Summary {document_index}",
            "PDF",
            f"{0.4 + (existing_count * 0.1):.1f} MB",
            appointment["appointment_date"]
        ))
    else:
        write_cursor.execute("""
            DELETE FROM medical_records
            WHERE appointment_id = %s
        """, (appointment_id,))

    conn.commit()
    write_cursor.close()
    cursor.close()
    conn.close()


# ===================================================
# ================= APPOINTMENT FUNCTIONS ===========
# ===================================================

def create_appointment(patient_id, doctor_id, appointment_date, appointment_time):
    """
    Create a new pending appointment.
    Validation prevents double booking and invalid doctor availability.
    """
    # Booking is only allowed for an existing doctor account.
    doctor = get_doctor_by_id(doctor_id)
    if not doctor:
        raise Exception("Doctor not found")

    # Convert the selected day and time into normalized values we can validate.
    appointment_day = datetime.strptime(appointment_date, "%Y-%m-%d").date()
    normalized_time = _normalize_time_value(appointment_time)

    availability_rows = get_doctor_availability(doctor_id)
    # The chosen day must be active inside the doctor's weekly availability.
    day_schedule = next((row for row in availability_rows if row["weekday"] == appointment_day.weekday()), None)
    if (
        not day_schedule
        or not day_schedule["is_active"]
        or not day_schedule.get("start_time")
        or not day_schedule.get("end_time")
    ):
        raise Exception("Doctor is not available on this day")

    # The selected time must match one of the generated slots for that day.
    available_slots = _build_time_slots(day_schedule["start_time"], day_schedule["end_time"])
    if normalized_time not in available_slots:
        raise Exception("Invalid appointment slot")

    if appointment_day < date.today():
        raise Exception("Appointment date cannot be in the past")

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # A doctor cannot receive two non-rejected appointments in the same slot.
    cursor.execute("""
        SELECT id
        FROM appointments
        WHERE doctor_id = %s
        AND appointment_date = %s
        AND appointment_time = %s
        AND status != 'REJECTED'
    """, (doctor_id, appointment_date, normalized_time))

    existing = cursor.fetchone()

    if existing:
        cursor.close()
        conn.close()
        raise Exception("This time slot is already booked")

    # Store the appointment as PENDING until a doctor approves or rejects it.
    insert_cursor = conn.cursor()

    insert_cursor.execute("""
        INSERT INTO appointments
        (patient_id, doctor_id, appointment_date, appointment_time, status)
        VALUES (%s, %s, %s, %s, 'PENDING')
    """, (patient_id, doctor_id, appointment_date, normalized_time))

    appointment_id = insert_cursor.lastrowid

    conn.commit()

    insert_cursor.close()
    cursor.close()
    conn.close()
    return appointment_id


def get_patient_appointments(patient_id):
    """Return patient appointments enriched with doctor name and specialty."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            a.*,
            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = %s
        ORDER BY appointment_date DESC, appointment_time DESC
    """, (patient_id,))

    appointments = cursor.fetchall()

    cursor.close()
    conn.close()
    return appointments


def get_all_appointments_from_db():
    """Return the global appointment list for the admin dashboard."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            a.*,
            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty,
            p.full_name AS patient_name
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        JOIN patients p ON a.patient_id = p.id
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
    """)

    appointments = cursor.fetchall()

    cursor.close()
    conn.close()
    return appointments


def get_appointment_by_id(appointment_id):
    """Return the raw appointment row, including notification tracking fields."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT *
        FROM appointments
        WHERE id = %s
    """, (appointment_id,))

    appointment = cursor.fetchone()

    cursor.close()
    conn.close()
    return appointment


def update_appointment_status_db(appointment_id, status):
    """Persist a new appointment status in the database."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE appointments
        SET status = %s
        WHERE id = %s
    """, (status, appointment_id))

    conn.commit()
    cursor.close()
    conn.close()


def mark_appointment_message_read(appointment_id, user_id, role):
    """Persist that the visible appointment message was read by this user."""
    ensure_appointment_notification_columns()

    if role not in {"patient", "doctor"}:
        return False

    read_column = "patient_message_read_at" if role == "patient" else "doctor_message_read_at"
    owner_column = "patient_id" if role == "patient" else "doctor_id"

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(f"""
        UPDATE appointments
        SET {read_column} = COALESCE({read_column}, NOW())
        WHERE id = %s
          AND {owner_column} = %s
    """, (appointment_id, user_id))

    updated = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return updated


def delete_appointment(appointment_id):
    """Remove one appointment from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        DELETE FROM medical_records
        WHERE appointment_id = %s
    """, (appointment_id,))

    cursor.execute("""
        DELETE FROM appointments
        WHERE id = %s
    """, (appointment_id,))

    conn.commit()
    cursor.close()
    conn.close()


def get_appointment_notification_details(appointment_id):
    """Load patient and doctor data required to build notification messages."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            a.id,
            a.status,
            a.appointment_date,
            a.appointment_time,
            a.status_notified_at,
            a.status_notified_value,
            a.notification_delivery_details,
            p.id AS patient_id,
            p.full_name AS patient_name,
            p.email AS patient_email,
            p.phone AS patient_phone,
            d.full_name AS doctor_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.id = %s
    """, (appointment_id,))

    details = cursor.fetchone()
    cursor.close()
    conn.close()
    return details


def mark_appointment_notification_sent(appointment_id, status):
    """Track that a final status notification has already been sent once."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE appointments
        SET status_notified_at = NOW(),
            status_notified_value = %s
        WHERE id = %s
    """, (status, appointment_id))

    conn.commit()
    cursor.close()
    conn.close()


def save_appointment_notification_details(appointment_id, notification_results):
    """Persist the latest channel delivery results for later display in the UI."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE appointments
        SET notification_delivery_details = %s
        WHERE id = %s
    """, (json.dumps(notification_results or []), appointment_id))

    conn.commit()
    cursor.close()
    conn.close()


def _load_notification_results(cursor, appointment_id):
    cursor.execute("""
        SELECT notification_delivery_details
        FROM appointments
        WHERE id = %s
    """, (appointment_id,))
    row = cursor.fetchone()

    if not row or not row[0]:
        return []

    try:
        data = json.loads(row[0])
    except (TypeError, json.JSONDecodeError):
        return []

    return data if isinstance(data, list) else []


def _upsert_sms_notification_result(notification_results, updates):
    sms_item = None
    for item in notification_results:
        if item.get("channel") == "sms":
            sms_item = item
            break

    if sms_item is None:
        sms_item = {"channel": "sms"}
        notification_results.append(sms_item)

    sms_item.update({key: value for key, value in updates.items() if value is not None})
    return notification_results


def save_appointment_sms_tracking(appointment_id, message_sid, provider_status=None, target=None):
    """Persist the Twilio message SID and the initial provider status."""
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor()
    notification_results = _load_notification_results(cursor, appointment_id)
    delivery_state = (provider_status or "queued").lower()

    _upsert_sms_notification_result(notification_results, {
        "sent": delivery_state not in {"failed", "undelivered"},
        "delivery_state": delivery_state,
        "provider_status": provider_status,
        "target": target,
        "message_sid": message_sid
    })

    cursor.execute("""
        UPDATE appointments
        SET sms_message_sid = %s,
            sms_delivery_status = %s,
            sms_delivery_updated_at = NOW(),
            notification_delivery_details = %s
        WHERE id = %s
    """, (
        message_sid,
        delivery_state,
        json.dumps(notification_results or []),
        appointment_id
    ))

    conn.commit()
    cursor.close()
    conn.close()


def update_appointment_sms_delivery_status(message_sid, message_status, raw_payload=None):
    """Update the stored appointment SMS delivery state using a Twilio callback."""
    ensure_appointment_notification_columns()

    normalized_status = str(message_status or "").strip().lower()
    raw_payload = raw_payload or {}

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id
        FROM appointments
        WHERE sms_message_sid = %s
        LIMIT 1
    """, (message_sid,))
    row = cursor.fetchone()

    if not row:
        cursor.close()
        conn.close()
        return False

    appointment_id = row[0]
    notification_results = _load_notification_results(cursor, appointment_id)
    error_message = raw_payload.get("ErrorMessage") or raw_payload.get("SmsErrorMessage")
    error_code = raw_payload.get("ErrorCode") or raw_payload.get("SmsErrorCode")

    _upsert_sms_notification_result(notification_results, {
        "sent": normalized_status not in {"failed", "undelivered"},
        "delivery_state": normalized_status or None,
        "provider_status": normalized_status or None,
        "target": raw_payload.get("To"),
        "message_sid": message_sid,
        "error_code": error_code,
        "reason": error_message or (f"Provider reported {normalized_status}" if normalized_status in {"failed", "undelivered"} else None)
    })

    cursor.execute("""
        UPDATE appointments
        SET sms_delivery_status = %s,
            sms_delivery_updated_at = NOW(),
            notification_delivery_details = %s
        WHERE id = %s
    """, (
        normalized_status,
        json.dumps(notification_results or []),
        appointment_id
    ))

    conn.commit()
    cursor.close()
    conn.close()
    return True


def delete_doctor_and_related_data(doctor_id):
    ensure_availability_table()
    ensure_doctor_patient_profiles_table()
    ensure_medical_records_table()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        DELETE FROM medical_records
        WHERE doctor_id = %s
    """, (doctor_id,))

    cursor.execute("""
        DELETE FROM doctor_patient_profiles
        WHERE doctor_id = %s
    """, (doctor_id,))

    cursor.execute("""
        DELETE FROM appointments
        WHERE doctor_id = %s
    """, (doctor_id,))

    cursor.execute("""
        DELETE FROM doctor_availability
        WHERE doctor_id = %s
    """, (doctor_id,))

    cursor.execute("""
        DELETE FROM doctors
        WHERE id = %s
    """, (doctor_id,))

    conn.commit()
    cursor.close()
    conn.close()


# ===================================================
# ================= STATISTICS ======================
# ===================================================

def get_appointment_stats(patient_id=None):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    if patient_id:
        cursor.execute("""
            SELECT 
                COUNT(*) AS total,
                SUM(status = 'PENDING') AS pending,
                SUM(status = 'APPROVED') AS approved,
                SUM(status = 'REJECTED') AS rejected
            FROM appointments
            WHERE patient_id = %s
        """, (patient_id,))
    else:
        cursor.execute("""
            SELECT 
                COUNT(*) AS total,
                SUM(status = 'PENDING') AS pending,
                SUM(status = 'APPROVED') AS approved,
                SUM(status = 'REJECTED') AS rejected
            FROM appointments
        """)

    stats = cursor.fetchone()

    cursor.close()
    conn.close()
    return stats

# ===================================================
# GET DOCTOR APPOINTMENTS (WITH PATIENT NAME)
# ===================================================

def get_doctor_appointments(doctor_id):
    ensure_appointment_notification_columns()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # Join appointments with patients table
    query = """
        SELECT 
            a.id,
            a.appointment_date,
            a.appointment_time,
            a.status,
            a.status_notified_at,
            a.doctor_message_read_at,
            a.notification_delivery_details,
            p.id AS patient_id,
            p.full_name AS patient_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.doctor_id = %s
        ORDER BY a.appointment_date DESC
    """

    cursor.execute(query, (doctor_id,))
    appointments = cursor.fetchall()

    cursor.close()
    conn.close()

    return appointments

# ===================================================
# GET DOCTOR APPOINTMENT STATS
# ===================================================

def get_doctor_appointment_stats(doctor_id):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    query = """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
        FROM appointments
        WHERE doctor_id = %s
    """

    cursor.execute(query, (doctor_id,))
    stats = cursor.fetchone()

    cursor.close()
    conn.close()

    return stats


def get_doctor_available_slots(doctor_id, days=10):
    """Build visible booking slots from the doctor's schedule and existing bookings."""
    doctor = get_doctor_by_id(doctor_id)
    if not doctor:
        return []

    availability_rows = get_doctor_availability(doctor_id)

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    start_day = date.today()
    end_day = start_day + timedelta(days=max(days, 1) + 14)

    cursor.execute("""
        SELECT appointment_date, appointment_time
        FROM appointments
        WHERE doctor_id = %s
          AND appointment_date BETWEEN %s AND %s
          AND status != 'REJECTED'
    """, (doctor_id, start_day.strftime("%Y-%m-%d"), end_day.strftime("%Y-%m-%d")))

    booked_rows = cursor.fetchall()
    cursor.close()
    conn.close()

    booked_lookup = {
        (row["appointment_date"].strftime("%Y-%m-%d"), _normalize_time_value(row["appointment_time"]))
        for row in booked_rows
    }

    now = datetime.now()
    available_days = []
    day_cursor = start_day
    max_iterations = max(days, 1) + 30
    iteration_count = 0

    # Walk forward day by day until enough visible booking days are collected.
    while len(available_days) < max(days, 1) and iteration_count < max_iterations:
        day_schedule = next((row for row in availability_rows if row["weekday"] == day_cursor.weekday()), None)
        if (
            day_schedule
            and day_schedule["is_active"]
            and day_schedule.get("start_time")
            and day_schedule.get("end_time")
        ):
            day_str = day_cursor.strftime("%Y-%m-%d")
            slots = []

            for slot in _build_time_slots(day_schedule["start_time"], day_schedule["end_time"]):
                slot_datetime = datetime.strptime(f"{day_str} {slot}", "%Y-%m-%d %H:%M")
                if slot_datetime <= now:
                    continue

                slots.append({
                    "time": slot,
                    "available": (day_str, slot) not in booked_lookup
                })

            if slots:
                available_days.append({
                    "date": day_str,
                    "slots": slots
                })

        day_cursor += timedelta(days=1)
        iteration_count += 1

    return available_days


def get_doctor_patients(doctor_id, search_query=None):
    """Return doctor patients with lightweight clinical metadata for the UI."""
    _seed_doctor_patient_profiles(doctor_id)

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    query = """
        SELECT
            p.id AS patient_id,
            p.full_name AS patient_name,
            COALESCE(dpp.age, 30) AS age,
            MAX(a.appointment_date) AS last_visit,
            COALESCE(
                dpp.clinical_status,
                CASE
                    WHEN SUM(a.status = 'APPROVED') > 0 THEN 'In Treatment'
                    WHEN SUM(a.status = 'PENDING') > 0 THEN 'Pending'
                    WHEN SUM(a.status = 'REJECTED') > 0 THEN 'Recovered'
                    ELSE 'Pending'
                END
            ) AS clinical_status
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        LEFT JOIN doctor_patient_profiles dpp
            ON dpp.doctor_id = a.doctor_id AND dpp.patient_id = a.patient_id
        WHERE a.doctor_id = %s
    """
    params = [doctor_id]

    if search_query:
        query += """
            AND (
                p.full_name LIKE %s
                OR CAST(p.id AS CHAR) LIKE %s
                OR COALESCE(dpp.clinical_status, '') LIKE %s
            )
        """
        like_value = f"%{search_query}%"
        params.extend([like_value, like_value, like_value])

    query += """
        GROUP BY p.id, p.full_name, dpp.age, dpp.clinical_status
        ORDER BY last_visit DESC, patient_name ASC
    """

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()

    cursor.close()
    conn.close()
    return rows


def get_doctor_reports(doctor_id):
    """Aggregate the numbers displayed in the doctor reports section."""
    _seed_doctor_patient_profiles(doctor_id)

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            COUNT(DISTINCT a.patient_id) AS new_patients,
            SUM(a.status = 'APPROVED') AS appointments_completed,
            SUM(a.status = 'PENDING') AS pending_requests,
            CASE
                WHEN COUNT(*) = 0 THEN 0
                ELSE 15
            END AS average_wait_time
        FROM appointments a
        WHERE a.doctor_id = %s
    """, (doctor_id,))
    summary = cursor.fetchone() or {}

    cursor.execute("""
        SELECT 'General Checkup' AS type_name, COUNT(*) AS total
        FROM appointments
        WHERE doctor_id = %s
        UNION ALL
        SELECT 'Specialist Consultation', GREATEST(COUNT(*) DIV 2, 1)
        FROM appointments
        WHERE doctor_id = %s
        UNION ALL
        SELECT 'Lab Tests', COUNT(*) DIV 3
        FROM appointments
        WHERE doctor_id = %s
        UNION ALL
        SELECT 'Follow-up', GREATEST(COUNT(*) DIV 2, 1)
        FROM appointments
        WHERE doctor_id = %s
    """, (doctor_id, doctor_id, doctor_id, doctor_id))
    appointment_types = cursor.fetchall()

    report_modules = [
        {"label": "Appointment trends", "status": "Ready"},
        {"label": "Prescription history", "status": "Ready"},
        {"label": "Diagnosis reports", "status": "Ready"},
        {"label": "Patient feedback", "status": "Ready"},
        {"label": "Billing summary", "status": "Ready"},
        {"label": "Custom report creation", "status": "Ready"},
    ]

    cursor.close()
    conn.close()

    return {
        "summary": {
            "new_patients": int(summary.get("new_patients") or 0),
            "appointments_completed": int(summary.get("appointments_completed") or 0),
            "pending_requests": int(summary.get("pending_requests") or 0),
            "average_wait_time": int(summary.get("average_wait_time") or 0),
        },
        "appointment_types": [
            {
                "label": row["type_name"],
                "value": int(row["total"] or 0)
            }
            for row in appointment_types
        ],
        "modules": report_modules
    }


def get_patient_medical_records(patient_id):
    """Return the medical record list shown in the patient dashboard."""
    seed_medical_records_for_patient(patient_id)

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            mr.id,
            mr.document_name,
            mr.created_at,
            mr.record_type,
            mr.file_size,
            d.full_name AS doctor_name
        FROM medical_records mr
        JOIN doctors d ON mr.doctor_id = d.id
        WHERE mr.patient_id = %s
        ORDER BY mr.created_at DESC, mr.id DESC
    """, (patient_id,))

    records = cursor.fetchall()
    cursor.close()
    conn.close()
    return records


def get_patient_medical_record_by_id(patient_id, record_id):
    """Return one patient-owned medical record for preview or download."""
    ensure_medical_records_table()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            mr.id,
            mr.patient_id,
            mr.doctor_id,
            mr.appointment_id,
            mr.document_name,
            mr.created_at,
            mr.record_type,
            mr.file_size,
            d.full_name AS doctor_name,
            d.specialty AS doctor_specialty,
            a.appointment_date,
            a.appointment_time,
            a.status AS appointment_status
        FROM medical_records mr
        JOIN doctors d ON mr.doctor_id = d.id
        LEFT JOIN appointments a ON mr.appointment_id = a.id
        WHERE mr.patient_id = %s
          AND mr.id = %s
    """, (patient_id, record_id))

    record = cursor.fetchone()
    cursor.close()
    conn.close()
    return record
