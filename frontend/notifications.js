const API_URL = window.APP_CONFIG?.API_URL || "http://127.0.0.1:5000";
const token = localStorage.getItem("token") || sessionStorage.getItem("token");

if (!token) {
    window.location.href = "login.html";
}

function parseJwt(jwtToken) {
    try {
        // Decode the JWT locally so the page can adapt to the current role.
        const base64 = jwtToken.split(".")[1];
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split("")
                .map(char => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );
        return JSON.parse(jsonPayload);
    } catch (error) {
        localStorage.removeItem("token");
        sessionStorage.removeItem("token");
        window.location.href = "login.html";
        throw error;
    }
}

const decoded = parseJwt(token);
let latestNotificationItems = [];
const notificationStatusRequests = new Set();
document.getElementById("role").innerText = decoded.role.charAt(0).toUpperCase() + decoded.role.slice(1);

loadNotifications();

async function loadNotifications() {
    // Doctors, admins, and patients read role-specific appointment feeds on this page.
    try {
        let endpoint = `${API_URL}/appointments`;

        if (decoded.role === "doctor") {
            endpoint = `${API_URL}/doctor/appointments`;
            document.getElementById("notificationsTitle").innerText = "Doctor Notifications";
            document.getElementById("notificationsSubtitle").innerText = "New patient requests and appointment decisions.";
        } else if (decoded.role === "admin") {
            endpoint = `${API_URL}/admin/appointments`;
            document.getElementById("notificationsTitle").innerText = "Admin Notifications";
            document.getElementById("notificationsSubtitle").innerText = "System-wide appointment activity, including all pending requests.";
        } else {
            document.getElementById("notificationsTitle").innerText = "Patient Notifications";
            document.getElementById("notificationsSubtitle").innerText = "Approval and rejection updates for your appointments.";
        }

        const response = await fetch(endpoint, {
            cache: "no-store",
            headers: { "Authorization": token }
        });

        const items = await response.json();
        if (!response.ok) {
            showToast(items.error || "Failed to load notifications", "error");
            return;
        }

        const normalizedItems = Array.isArray(items) ? items : [];
        let visibleItems = normalizedItems;

        if (decoded.role === "admin" || decoded.role === "doctor") {
            visibleItems = normalizedItems.filter(item => item.status === "PENDING");
        } else {
            visibleItems = normalizedItems.filter(item => item.status === "APPROVED" || item.status === "REJECTED");
        }

        latestNotificationItems = visibleItems;
        renderNotifications(visibleItems);
    } catch (error) {
        console.error("Notifications error:", error);
        showToast("Unexpected error while loading notifications", "error");
    }
}

function renderNotifications(items) {
    // Build a card-based inbox view from appointment status data.
    const list = document.getElementById("notificationsList");

    if (!items.length) {
        list.innerHTML = `<div class="empty-message">${escapeHtml(getEmptyNotificationMessage())}</div>`;
        return;
    }

    list.innerHTML = items.map(item => {
        if (decoded.role === "doctor") {
            const isUpdating = isNotificationStatusPending(item.id);
            return `
                <article class="notification-card">
                    <div class="notification-icon pending-note">
                        <i class="fa-solid fa-user-clock"></i>
                    </div>
                    <div class="notification-content">
                        <strong>${escapeHtml(item.patient_name || "Patient")}</strong>
                        <p>Appointment request for ${escapeHtml(item.appointment_date)} at ${escapeHtml(item.appointment_time)}.</p>
                        <span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
                        ${item.status === "PENDING" ? `
                            <div class="notification-actions">
                                <button class="action-btn approve-btn" onclick="updateNotificationStatus(${item.id}, 'APPROVED')" ${isUpdating ? "disabled" : ""}>${isUpdating ? "Updating..." : "Approve"}</button>
                                <button class="action-btn reject-btn" onclick="updateNotificationStatus(${item.id}, 'REJECTED')" ${isUpdating ? "disabled" : ""}>${isUpdating ? "Updating..." : "Reject"}</button>
                            </div>
                        ` : ""}
                    </div>
                </article>
            `;
        }

        if (decoded.role === "admin") {
            const noteText = item.status === "PENDING"
                ? "A patient request is pending review by a doctor."
                : `This appointment is currently ${item.status.toLowerCase()}.`;

            return `
                <article class="notification-card">
                    <div class="notification-icon ${item.status === "APPROVED" ? "approved-note" : item.status === "REJECTED" ? "rejected-note" : "pending-note"}">
                        <i class="fa-solid fa-hospital-user"></i>
                    </div>
                    <div class="notification-content">
                        <strong>${escapeHtml(item.patient_name || "Patient")} with ${escapeHtml(item.doctor_name || "Doctor")}</strong>
                        <p>${escapeHtml(noteText)}</p>
                        <small>${escapeHtml(item.appointment_date)} at ${escapeHtml(item.appointment_time)}</small>
                    </div>
                </article>
            `;
        }

        const noteText = item.status === "PENDING"
            ? "Your appointment request is still pending."
            : `Your appointment was ${item.status.toLowerCase()}.`;

        return `
            <article class="notification-card">
                <div class="notification-icon ${item.status === "APPROVED" ? "approved-note" : item.status === "REJECTED" ? "rejected-note" : "pending-note"}">
                    <i class="fa-solid fa-bell"></i>
                </div>
                <div class="notification-content">
                    <strong>${escapeHtml(item.doctor_name || `Doctor #${item.doctor_id}`)}</strong>
                    <p>${escapeHtml(noteText)}</p>
                    <small>${escapeHtml(item.appointment_date)} at ${escapeHtml(item.appointment_time)}</small>
                </div>
            </article>
        `;
    }).join("");
}

function getEmptyNotificationMessage() {
    if (decoded.role === "patient") {
        return "No appointment decisions yet. Pending requests stay in Appointments.";
    }

    if (decoded.role === "doctor") {
        return "No pending patient requests right now.";
    }

    return "No pending system notifications right now.";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseNotificationDetails(rawValue) {
    if (!rawValue) return [];
    if (Array.isArray(rawValue)) return rawValue;

    try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatNotificationTimestamp(rawValue) {
    if (!rawValue) return "";

    const normalized = String(rawValue).replace(" ", "T");
    const parsedDate = new Date(normalized);
    if (Number.isNaN(parsedDate.getTime())) return String(rawValue);

    return parsedDate.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function getVisibleNotificationDetails(rawValue) {
    return [];
}

function isNotificationStatusPending(appointmentId) {
    return notificationStatusRequests.has(`${appointmentId}:APPROVED`)
        || notificationStatusRequests.has(`${appointmentId}:REJECTED`);
}

async function updateNotificationStatus(appointmentId, status) {
    // Doctors can approve or reject directly from the notifications screen.
    const requestKey = `${appointmentId}:${status}`;
    if (notificationStatusRequests.has(requestKey)) {
        showToast("Status update already in progress", "info");
        return;
    }

    notificationStatusRequests.add(requestKey);
    try {
        const response = await fetch(`${API_URL}/appointments/${appointmentId}/status`, {
            method: "PUT",
            cache: "no-store",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({ status })
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to update appointment", "error");
            return;
        }

        showToast(`Appointment ${status.toLowerCase()} successfully`, "success");
        renderNotifications(latestNotificationItems);
        await loadNotifications();
    } catch (error) {
        console.error("Notification update error:", error);
        showToast("Unexpected error while updating appointment", "error");
    } finally {
        notificationStatusRequests.delete(requestKey);
    }
}

function scheduleNotificationsRefresh(appointmentId) {
    return;
}

function refreshDeliveryPanelFromNotifications(appointmentId) {
    return;
}

function logout() {
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    window.location.href = "login.html";
}

function showToast(message, type = "info") {
    // Temporary UI feedback for async actions on the page.
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

function formatNotificationSummary(notifications) {
    return "";
}

function showDeliveryStatus(notifications, heading = "Notification delivery details") {
    const panel = document.getElementById("deliveryStatusPanel");
    if (!panel) return;

    panel.style.display = "none";
    panel.innerHTML = "";
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
            : "Accepted by provider. The page will refresh shortly with the latest status.";
    }
    if (state === "delivered") {
        return "Confirmed as delivered by the provider.";
    }
    if (state === "sent") {
        return "Sent to the mobile network by the provider.";
    }
    return "Delivered to the provider successfully.";
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
