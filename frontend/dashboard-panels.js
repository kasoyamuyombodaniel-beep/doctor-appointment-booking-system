// @ts-nocheck

function renderUpcomingAppointments(appointments) {
    const container = document.getElementById("upcomingAppointments");
    if (!container) return;

    if (!appointments.length) {
        container.innerHTML = `<div class="simple-card">No upcoming appointments yet.</div>`;
        return;
    }

    container.innerHTML = appointments.map(appointment => `
        <div class="simple-card">
            <strong>${escapeHtml(appointment.doctor_name || appointment.patient_name || "Appointment")}</strong>
            <p>${escapeHtml(appointment.doctor_specialty || "Consultation")}</p>
            <span>${escapeHtml(appointment.appointment_date)} at ${escapeHtml(appointment.appointment_time)}</span>
        </div>
    `).join("");
}

function renderRecentMessages(messages) {
    const container = document.getElementById("recentMessages");
    if (!container) return;

    if (!messages.length) {
        container.innerHTML = `<div class="simple-card">No recent messages.</div>`;
        return;
    }

    container.innerHTML = messages.map((message, index) => `
        <button class="message-preview-card" type="button" onclick="openInboxMessage(${index})">
            <strong>${escapeHtml(message.doctorName)}</strong>
            <p>${escapeHtml(message.preview)}</p>
            <span>${escapeHtml(message.createdAt)}</span>
        </button>
    `).join("");
}

function renderRecentActivity(items) {
    const container = document.getElementById("recentActivity");
    if (!container) return;

    if (!items.length) {
        container.innerHTML = `<div class="simple-card">No recent activity.</div>`;
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="activity-item">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.meta)}</span>
        </div>
    `).join("");
}

function renderInbox(messages) {
    const list = document.getElementById("inboxList");
    if (!list) return;

    if (!messages.length) {
        list.innerHTML = `<div class="empty-message">No messages available.</div>`;
        setText("selectedMessageTitle", "Select a message");
        setText("selectedMessageContent", "Choose a message from the inbox to read its full content.");
        return;
    }

    list.innerHTML = messages.map((message, index) => `
        <button class="message-list-item ${message.unread ? "unread" : ""}" type="button" onclick="openInboxMessage(${index})">
            <strong>${escapeHtml(message.doctorName)}</strong>
            <p>${escapeHtml(message.preview)}</p>
            <span>${escapeHtml(message.createdAt)}</span>
        </button>
    `).join("");

    openInboxMessage(0, false);
}

function getDashboardNotificationCount() {
    return inboxMessages.filter(item => item.unread).length;
}

function handleNotificationButtonClick() {
    if (decoded.role === "patient" || decoded.role === "doctor") {
        showSection("inbox");
        const unreadIndex = inboxMessages.findIndex(item => item.unread);
        if (unreadIndex >= 0) {
            openInboxMessage(unreadIndex);
        }
        return;
    }

    window.location.href = "notifications.html";
}

function openInboxMessage(index, markAsRead = true) {
    const message = inboxMessages[index];
    if (!message) return;

    if (markAsRead && message.unread) {
        message.unread = false;
        setText("notificationCounter", getDashboardNotificationCount());
        setText("settingsNotificationCount", getDashboardNotificationCount());
        renderInbox(inboxMessages);
        openInboxMessage(index, false);
        return;
    }

    document.querySelectorAll(".message-list-item").forEach((item, itemIndex) => {
        item.classList.toggle("active", itemIndex === index);
    });

    setText("selectedMessageTitle", message.title);
    setText("selectedMessageContent", message.content);
}

function renderMedicalRecords(records) {
    // Render the patient record table or an empty-state message.
    const tbody = document.getElementById("recordsBody");
    if (!tbody) return;

    if (!records.length) {
        const label = decoded.role === "patient"
            ? "Medical records will appear here after approved appointments."
            : "No records available for this view.";
        tbody.innerHTML = `
            <tr>
                <td colspan="6">${escapeHtml(label)}</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = records.map(record => `
        <tr>
            <td>${escapeHtml(record.name)}</td>
            <td>${escapeHtml(record.date)}</td>
            <td>${escapeHtml(record.doctor)}</td>
            <td>${escapeHtml(record.type)}</td>
            <td>${escapeHtml(record.size)}</td>
            <td class="records-actions">
                <button class="mini-btn" type="button" onclick="viewMedicalRecord(${record.id})">View</button>
                <button class="mini-btn" type="button" onclick="downloadMedicalRecord(${record.id})">Download</button>
            </td>
        </tr>
    `).join("");
}

async function viewMedicalRecord(recordId) {
    // Open a print-friendly preview in a new tab using record metadata from the API.
    try {
        const response = await fetch(`${API_URL}/medical-records/${recordId}`, {
            headers: { "Authorization": token }
        });
        const record = await response.json();

        if (!response.ok) {
            showToast(record.error || "Failed to load medical record", "error");
            return;
        }

        const previewWindow = window.open("", "_blank", "width=860,height=720");
        if (!previewWindow) {
            showToast("Popup blocked. Please allow popups to preview the record", "info");
            return;
        }

        const appointmentLine = record.appointment_date && record.appointment_time
            ? `${record.appointment_date} at ${record.appointment_time}`
            : "Not linked to an appointment";

        previewWindow.document.write(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>${escapeHtml(record.document_name)}</title>
                <style>
                    body { font-family: Georgia, serif; margin: 40px; color: #1c2c3d; line-height: 1.6; }
                    h1 { margin-bottom: 8px; color: #16395f; }
                    .meta { margin-bottom: 28px; color: #55697f; }
                    .card { border: 1px solid #dbe5ef; border-radius: 18px; padding: 22px; margin-bottom: 18px; background: #f8fbff; }
                    strong { color: #16395f; }
                </style>
            </head>
            <body>
                <h1>${escapeHtml(record.document_name)}</h1>
                <p class="meta">Generated medical record for patient ID #${escapeHtml(String(decoded.user_id))}</p>
                <div class="card">
                    <p><strong>Doctor:</strong> ${escapeHtml(record.doctor_name || "Unknown doctor")}</p>
                    <p><strong>Specialty:</strong> ${escapeHtml(record.doctor_specialty || "Not specified")}</p>
                    <p><strong>Record Type:</strong> ${escapeHtml(record.record_type || "Consultation")}</p>
                    <p><strong>File Size:</strong> ${escapeHtml(record.file_size || "Unknown")}</p>
                    <p><strong>Created At:</strong> ${escapeHtml(record.created_at || "Unknown date")}</p>
                    <p><strong>Appointment:</strong> ${escapeHtml(appointmentLine)}</p>
                    <p><strong>Status:</strong> ${escapeHtml(formatStatusLabel(record.appointment_status || "APPROVED"))}</p>
                </div>
                <div class="card">
                    <p><strong>Clinical Summary</strong></p>
                    <p>This record confirms that a consultation was registered in the system and linked to an approved appointment. It includes the attending doctor, appointment timing, and file metadata prepared for the patient portal.</p>
                </div>
            </body>
            </html>
        `);
        previewWindow.document.close();
    } catch (error) {
        console.error("Error viewing medical record:", error);
        showToast("Unexpected error while opening the medical record", "error");
    }
}

async function downloadMedicalRecord(recordId) {
    // Generate a simple downloadable text file from the record payload.
    try {
        const response = await fetch(`${API_URL}/medical-records/${recordId}`, {
            headers: { "Authorization": token }
        });
        const record = await response.json();

        if (!response.ok) {
            showToast(record.error || "Failed to download medical record", "error");
            return;
        }

        const lines = [
            record.document_name || "Medical Record",
            `Doctor: ${record.doctor_name || "Unknown doctor"}`,
            `Specialty: ${record.doctor_specialty || "Not specified"}`,
            `Record Type: ${record.record_type || "Consultation"}`,
            `Created At: ${record.created_at || "Unknown date"}`,
            `Appointment Date: ${record.appointment_date || "Unknown date"}`,
            `Appointment Time: ${record.appointment_time || "Unknown time"}`,
            `Appointment Status: ${record.appointment_status || "APPROVED"}`,
            "",
            "Clinical Summary:",
            "This medical record was generated from an approved appointment in the Doctor Appointment Booking System."
        ];

        const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `${(record.document_name || "medical-record").replace(/\s+/g, "-").toLowerCase()}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
        showToast("Medical record downloaded successfully", "success");
    } catch (error) {
        console.error("Error downloading medical record:", error);
        showToast("Unexpected error while downloading the medical record", "error");
    }
}

function getPatientMessageTitle(appointment) {
    if (appointment.status === "APPROVED") return "Appointment approved";
    if (appointment.status === "REJECTED") return "Appointment rejected";
    return "Appointment pending";
}

function getPatientMessagePreview(appointment) {
    const doctorName = appointment.doctor_name || `Doctor #${appointment.doctor_id}`;
    return `${doctorName} - ${formatStatusLabel(appointment.status)}`;
}

function getPatientMessageContent(appointment) {
    const doctorName = appointment.doctor_name || `Doctor #${appointment.doctor_id}`;
    return `Your appointment with ${doctorName} on ${appointment.appointment_date} at ${appointment.appointment_time} is currently ${formatStatusLabel(appointment.status).toLowerCase()}.`;
}

function getActivityLabel(appointment) {
    if (appointment.status === "APPROVED") return "Appointment confirmed";
    if (appointment.status === "REJECTED") return "Appointment rejected";
    return "Appointment request sent";
}

function isUpcomingAppointment(appointment) {
    if (!appointment?.appointment_date || !appointment?.appointment_time) return false;
    const appointmentDate = new Date(`${appointment.appointment_date}T${appointment.appointment_time}`);
    return appointmentDate >= new Date() && appointment.status !== "REJECTED";
}

function compareAppointmentDateTime(left, right) {
    const leftDate = new Date(`${left.appointment_date}T${left.appointment_time}`);
    const rightDate = new Date(`${right.appointment_date}T${right.appointment_time}`);
    return leftDate - rightDate;
}

function filterAppointmentsBySearch(appointments, query) {
    if (!query) return appointments;

    return appointments.filter(appointment => {
        const haystack = [
            appointment.doctor_name,
            appointment.doctor_specialty,
            appointment.patient_name,
            appointment.appointment_date,
            appointment.appointment_time,
            appointment.status
        ].filter(Boolean).join(" ").toLowerCase();

        return haystack.includes(query);
    });
}

function formatStatusLabel(status) {
    if (!status) return "Unknown";
    return status.charAt(0) + status.slice(1).toLowerCase();
}

function getNotificationStateLabel(item) {
    const state = String(item.delivery_state || item.provider_status || "").toLowerCase();
    if (!item.sent) return "Failed";
    if (state === "queued" || state === "accepted") return item.channel === "sms" ? "Sent" : "Sending";
    if (state === "delivered") return "Delivered";
    if (state === "sent") return "Sent";
    return item.channel === "email" ? "Sent" : "Processed";
}

function getNotificationStateDetails(item) {
    const state = String(item.delivery_state || item.provider_status || "").toLowerCase();
    if (!item.sent) return humanizeNotificationReason(item.reason);
    if (state === "queued" || state === "accepted") {
        return item.channel === "sms"
            ? "Accepted by Twilio and handed off for mobile delivery."
            : "Accepted by provider. The dashboard will refresh shortly with the latest status.";
    }
    if (state === "delivered") {
        return "Confirmed as delivered by the provider.";
    }
    if (state === "sent") {
        return "Sent to the mobile network by the provider.";
    }
    return "Delivered to the provider successfully.";
}

function getVisibleNotificationDetails(notifications) {
    if (!Array.isArray(notifications)) return [];
    return notifications.filter(item => item && item.channel);
}

function formatNotificationSummary(notifications) {
    const items = getVisibleNotificationDetails(Array.isArray(notifications) ? notifications : parseNotificationDetails(notifications));
    if (!items.length) return "";

    return items
        .map(item => `${String(item.channel || "").toUpperCase()}: ${getNotificationStateLabel(item)}`)
        .join(" / ");
}

function humanizeNotificationReason(reason) {
    const message = String(reason || "").trim();
    if (!message) return "Unknown error";

    if (message.includes("Permission to send an SMS has not been enabled")) {
        return "Twilio has not enabled SMS for the patient's country or region yet";
    }

    if (message.includes("Email not configured")) {
        return "email settings are not configured in the backend";
    }

    if (message.includes("SMS not configured")) {
        return "Twilio settings or the patient phone number are missing";
    }

    if (message.includes("Patient phone number missing")) {
        return "patient phone number is missing";
    }

    if (message.includes("country code")) {
        return "patient phone number must include the country code, for example +243...";
    }

    return message;
}

function showDeliveryStatus(notifications, heading = "Notification delivery details") {
    const panel = document.getElementById("deliveryStatusPanel");
    if (!panel) return;

    panel.style.display = "none";
    panel.innerHTML = "";
}

function activateSettingsTab(button) {
    document.querySelectorAll(".tab-button").forEach(tab => {
        tab.classList.toggle("active", tab === button);
    });

    const selectedPanel = button?.dataset.settingsTab || "account";
    document.querySelectorAll(".settings-tab-panel").forEach(panel => {
        panel.classList.toggle("active", panel.dataset.settingsPanel === selectedPanel);
    });
}

function handleProfileUpdateClick() {
    if (!currentProfile) {
        showToast("Profile data is not loaded yet", "error");
        return;
    }

    const fullName = window.prompt("Full name:", currentProfile.full_name || "");
    if (!fullName) return;

    const email = window.prompt("Email:", currentProfile.email || "");
    if (!email) return;

    let payload;
    if (decoded.role === "doctor") {
        const specialty = window.prompt("Specialty:", currentProfile.specialty || "");
        if (!specialty) return;

        const password = window.prompt("New password (optional):", "");
        payload = {
            full_name: fullName,
            email,
            specialty,
            password: password || ""
        };
    } else {
        const phone = window.prompt("Phone:", currentProfile.phone || "");
        if (!phone) return;

        const password = window.prompt("New password (optional):", "");
        payload = {
            full_name: fullName,
            email,
            phone,
            password: password || ""
        };
    }

    fetch(`${API_URL}/profile`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": token
        },
        body: JSON.stringify(payload)
    })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(async ({ ok, data }) => {
            if (!ok) {
                showToast(data.error || "Failed to update profile", "error");
                return;
            }

            showToast(data.message || "Profile updated successfully", "success");
            await loadProfile();
        })
        .catch(() => {
            showToast("Unexpected error while updating profile", "error");
        });
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.innerText = value;
    }
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) {
        input.value = value;
    }
}

function setAvatar(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.innerText = value;
    }
}

function escapeText(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function logout() {
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    window.location.href = "login.html";
}

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add("toast-hide");
        window.setTimeout(() => toast.remove(), 240);
    }, 2600);
}
