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
        const visibleItems = decoded.role === "admin"
            ? normalizedItems.filter(item => item.status === "PENDING")
            : normalizedItems;

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
        list.innerHTML = `<div class="empty-message">No notifications found.</div>`;
        return;
    }

    list.innerHTML = items.map(item => {
        if (decoded.role === "doctor") {
            const deliveryDetails = parseNotificationDetails(item.notification_delivery_details);
            const attemptedAt = formatNotificationTimestamp(item.status_notified_at);
            return `
                <article class="notification-card">
                    <div class="notification-icon pending-note">
                        <i class="fa-solid fa-user-clock"></i>
                    </div>
                    <div class="notification-content">
                        <strong>${item.patient_name}</strong>
                        <p>Appointment request for ${item.appointment_date} at ${item.appointment_time}.</p>
                        <span class="status ${item.status}">${item.status}</span>
                        ${renderStoredDeliveryDetails(deliveryDetails)}
                        ${attemptedAt ? `<small class="delivery-attempt-time">Last notification attempt: ${attemptedAt}</small>` : ""}
                        ${item.status === "PENDING" ? `
                            <div class="notification-actions">
                                <button class="action-btn approve-btn" onclick="updateNotificationStatus(${item.id}, 'APPROVED')">Approve</button>
                                <button class="action-btn reject-btn" onclick="updateNotificationStatus(${item.id}, 'REJECTED')">Reject</button>
                            </div>
                        ` : ""}
                    </div>
                </article>
            `;
        }

        if (decoded.role === "admin") {
            const deliveryDetails = parseNotificationDetails(item.notification_delivery_details);
            const attemptedAt = formatNotificationTimestamp(item.status_notified_at);
            const noteText = item.status === "PENDING"
                ? "A patient request is pending review by a doctor."
                : `This appointment is currently ${item.status.toLowerCase()}.`;

            return `
                <article class="notification-card">
                    <div class="notification-icon ${item.status === "APPROVED" ? "approved-note" : item.status === "REJECTED" ? "rejected-note" : "pending-note"}">
                        <i class="fa-solid fa-hospital-user"></i>
                    </div>
                    <div class="notification-content">
                        <strong>${item.patient_name || "Patient"} with ${item.doctor_name || "Doctor"}</strong>
                        <p>${noteText}</p>
                        <small>${item.appointment_date} at ${item.appointment_time}</small>
                        ${renderStoredDeliveryDetails(deliveryDetails)}
                        ${attemptedAt ? `<small class="delivery-attempt-time">Last notification attempt: ${attemptedAt}</small>` : ""}
                    </div>
                </article>
            `;
        }

        const noteText = item.status === "PENDING"
            ? "Your appointment request is still pending."
            : `Your appointment was ${item.status.toLowerCase()}.`;
        const deliveryDetails = parseNotificationDetails(item.notification_delivery_details);
        const attemptedAt = formatNotificationTimestamp(item.status_notified_at);

        return `
            <article class="notification-card">
                <div class="notification-icon ${item.status === "APPROVED" ? "approved-note" : item.status === "REJECTED" ? "rejected-note" : "pending-note"}">
                    <i class="fa-solid fa-bell"></i>
                </div>
                <div class="notification-content">
                    <strong>${item.doctor_name || `Doctor #${item.doctor_id}`}</strong>
                    <p>${noteText}</p>
                    <small>${item.appointment_date} at ${item.appointment_time}</small>
                    ${renderStoredDeliveryDetails(deliveryDetails)}
                    ${attemptedAt ? `<small class="delivery-attempt-time">Last notification attempt: ${attemptedAt}</small>` : ""}
                </div>
            </article>
        `;
    }).join("");
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

function renderStoredDeliveryDetails(items) {
    if (!Array.isArray(items) || !items.length) return "";

    return `
        <div class="inline-delivery-summary">
            ${items.map(item => `
                <span class="inline-delivery-chip ${item.sent ? "inline-delivery-ok" : "inline-delivery-fail"}">
                    ${item.channel === "email" ? "Email" : "SMS"}: ${getNotificationStateLabel(item)}
                </span>
            `).join("")}
        </div>
    `;
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

        const notifications = Array.isArray(data.notifications) ? data.notifications : [];
        const notificationSummary = formatNotificationSummary(notifications);

        showDeliveryStatus(notifications, "Appointment notification details");
        showToast(
            notificationSummary
                ? `Appointment ${status.toLowerCase()} successfully. ${notificationSummary}`
                : `Appointment ${status.toLowerCase()} successfully`,
            notificationSummary.toLowerCase().includes("failed") ? "info" : "success"
        );
        await loadNotifications();
        scheduleNotificationsRefresh(appointmentId);
    } catch (error) {
        console.error("Notification update error:", error);
        showToast("Unexpected error while updating appointment", "error");
    } finally {
        notificationStatusRequests.delete(requestKey);
    }
}

function scheduleNotificationsRefresh(appointmentId) {
    window.setTimeout(async () => {
        try {
            await loadNotifications();
            refreshDeliveryPanelFromNotifications(appointmentId);
        } catch (error) {
            console.error("Error refreshing notifications:", error);
        }
    }, 4000);
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
    if (!Array.isArray(notifications) || !notifications.length) return "";

    return notifications.map(item => {
        const channelLabel = item.channel === "email" ? "Email" : "SMS";
        if (item.sent) {
            return `${channelLabel} ${getNotificationStateLabel(item).toLowerCase()}`;
        }

        return `${channelLabel} failed: ${humanizeNotificationReason(item.reason)}`;
    }).join(" | ");
}

function showDeliveryStatus(notifications, heading = "Notification delivery details") {
    const panel = document.getElementById("deliveryStatusPanel");
    if (!panel) return;

    if (!Array.isArray(notifications) || !notifications.length) {
        panel.style.display = "none";
        panel.innerHTML = "";
        return;
    }

    panel.style.display = "block";
    panel.innerHTML = `
        <div class="delivery-status-header">
            <strong>${heading}</strong>
            <span>Latest result</span>
        </div>
        <div class="delivery-status-list">
            ${notifications.map(item => {
                const label = item.channel === "email" ? "Email" : "SMS";
                const state = getNotificationStateLabel(item);
                const details = getNotificationStateDetails(item);
                const target = item.target ? ` Target: ${item.target}` : "";

                return `
                    <article class="delivery-status-item ${item.sent ? "delivery-status-ok" : "delivery-status-fail"}">
                        <div>
                            <p>${label}</p>
                            <strong>${state}</strong>
                        </div>
                        <span>${details}${target}</span>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

function getNotificationStateLabel(item) {
    const state = String(item.delivery_state || item.provider_status || "").toLowerCase();
    if (!item.sent) return "Failed";
    if (state === "queued" || state === "accepted") return "Sending";
    if (state === "delivered") return "Delivered";
    if (state === "sent") return "Sent";
    return item.channel === "email" ? "Sent" : "Processed";
}

function getNotificationStateDetails(item) {
    const state = String(item.delivery_state || item.provider_status || "").toLowerCase();
    if (!item.sent) return humanizeNotificationReason(item.reason);
    if (state === "queued" || state === "accepted") {
        return "Accepted by provider. The page will refresh shortly with the latest status.";
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
