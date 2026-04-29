CREATE DATABASE IF NOT EXISTS doctor_booking_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE doctor_booking_db;

CREATE TABLE IF NOT EXISTS patients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    role ENUM('patient', 'admin') NOT NULL DEFAULT 'patient',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_patient_email (email)
);

CREATE TABLE IF NOT EXISTS doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    specialty VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_doctor_email (email)
);

CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    status_notified_at DATETIME NULL,
    status_notified_value VARCHAR(20) NULL,
    patient_message_read_at DATETIME NULL,
    doctor_message_read_at DATETIME NULL,
    notification_delivery_details TEXT NULL,
    sms_message_sid VARCHAR(64) NULL,
    sms_delivery_status VARCHAR(32) NULL,
    sms_delivery_updated_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_appointments_patient (patient_id),
    KEY idx_appointments_doctor (doctor_id),
    KEY idx_appointments_slot (doctor_id, appointment_date, appointment_time),
    CONSTRAINT fk_appointments_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_appointments_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS doctor_availability (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    weekday TINYINT NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY unique_doctor_weekday (doctor_id, weekday),
    CONSTRAINT fk_doctor_availability_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS doctor_patient_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    age INT NULL,
    clinical_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    notes TEXT NULL,
    UNIQUE KEY unique_doctor_patient (doctor_id, patient_id),
    CONSTRAINT fk_doctor_patient_profiles_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_doctor_patient_profiles_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medical_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_id INT NULL,
    document_name VARCHAR(255) NOT NULL,
    record_type VARCHAR(100) NOT NULL DEFAULT 'Consultation',
    file_size VARCHAR(50) NOT NULL DEFAULT '0.4 MB',
    created_at DATE NOT NULL,
    UNIQUE KEY unique_appointment_record (appointment_id),
    KEY idx_medical_records_patient (patient_id),
    KEY idx_medical_records_doctor (doctor_id),
    CONSTRAINT fk_medical_records_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_medical_records_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_medical_records_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_token_hash (token_hash),
    KEY idx_password_reset_email (email),
    KEY idx_password_reset_expires (expires_at)
);

-- Optional seed admin account
-- Password must be a bcrypt hash, not plain text.
-- Example:
-- INSERT INTO patients (full_name, email, password, phone, role)
-- VALUES ('System Admin', 'admin@test.com', '$2b$12$replace_with_bcrypt_hash', '0000000000', 'admin');
