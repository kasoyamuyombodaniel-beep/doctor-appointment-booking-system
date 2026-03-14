"""Core database and shared scheduling helpers."""

from models import (
    DEFAULT_DOCTOR_AVAILABILITY,
    SLOT_INTERVAL_MINUTES,
    _build_time_slots,
    _normalize_time_value,
    ensure_appointment_notification_columns,
    ensure_availability_table,
    ensure_doctor_patient_profiles_table,
    ensure_medical_records_table,
    get_db_connection,
)
