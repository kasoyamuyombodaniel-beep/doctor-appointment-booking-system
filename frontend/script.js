const API_URL = window.APP_CONFIG?.API_URL || "http://127.0.0.1:5000";
let loginInProgress = false;
let backendWarmupStarted = false;

async function login(){
    // Read the selected role and credentials from the login form.
    if (loginInProgress) return;

    const role = document.getElementById("roleSelect").value;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const rememberMe = document.getElementById("rememberMe")?.checked;
    const errorNode = document.getElementById("error");

    if (errorNode) errorNode.innerText = "";

    if (!email || !password) {
        if (errorNode) errorNode.innerText = "Email and password are required";
        showToast("Email and password are required", "error");
        return;
    }

    loginInProgress = true;
    setLoginButtonState(true);

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({role, email, password})
        });

        const data = await response.json();

        if (response.ok){
            // Keep the token across browser restarts only when "Remember me" is checked.
            if (rememberMe) {
                localStorage.setItem("token", data.token);
            } else {
                sessionStorage.setItem("token", data.token);
                localStorage.removeItem("token");
            }
            window.location.href = "dashboard.html";
        } else {
            if (errorNode) errorNode.innerText = data.error || "Login failed";
            showToast(data.error || "Login failed", "error");
        }
    } catch (error) {
        console.error("Login error:", error);
        if (errorNode) errorNode.innerText = "Unable to contact the server";
        showToast("Unable to contact the server", "error");
    } finally {
        loginInProgress = false;
        setLoginButtonState(false);
    }
}

function setLoginButtonState(isLoading) {
    const button = document.querySelector(".login-button");
    if (!button) return;

    button.disabled = isLoading;
    button.classList.toggle("is-loading", isLoading);
    button.innerText = isLoading ? "Signing in..." : "Sign In";
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input || !button) return;

    const icon = button.querySelector("i");
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";

    if (icon) {
        icon.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
    }

    button.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
}

function forgotPassword(event) {
    // Start the secure password reset flow by requesting a reset link.
    event.preventDefault();
    const email = window.prompt("Enter the email address for the account:");
    if (!email) return;

    fetch(`${API_URL}/forgot-password`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email: email.trim()
        })
    })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                showToast(data.error || "Failed to start password reset", "error");
                return;
            }
            showToast(
                data.message || "If the account exists, a reset link has been generated",
                "success"
            );
        })
        .catch(() => {
            showToast("Unexpected error while requesting password reset", "error");
        });
}


async function submitResetPassword() {
    const tokenInput = document.getElementById("resetToken");
    const passwordInput = document.getElementById("newPassword");
    const confirmInput = document.getElementById("confirmPassword");
    const errorNode = document.getElementById("resetError");

    if (!tokenInput || !passwordInput || !confirmInput) return;

    const token = tokenInput.value.trim();
    const newPassword = passwordInput.value;
    const confirmPassword = confirmInput.value;

    if (errorNode) {
        errorNode.innerText = "";
    }

    if (!token) {
        if (errorNode) errorNode.innerText = "Reset token is missing";
        showToast("Reset token is missing", "error");
        return;
    }

    if (newPassword.length < 8) {
        if (errorNode) errorNode.innerText = "Password must be at least 8 characters";
        showToast("Password must be at least 8 characters", "error");
        return;
    }

    if (newPassword !== confirmPassword) {
        if (errorNode) errorNode.innerText = "Passwords do not match";
        showToast("Passwords do not match", "error");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/reset-password`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token,
                new_password: newPassword
            })
        });

        const data = await response.json();
        if (!response.ok) {
            if (errorNode) errorNode.innerText = data.error || "Unable to reset password";
            showToast(data.error || "Unable to reset password", "error");
            return;
        }

        showToast(data.message || "Password updated successfully", "success");
        window.setTimeout(() => {
            window.location.href = "login.html";
        }, 1200);
    } catch (error) {
        console.error("Reset password error:", error);
        if (errorNode) errorNode.innerText = "Unexpected error while resetting password";
        showToast("Unexpected error while resetting password", "error");
    }
}


function initResetPasswordPage() {
    const tokenInput = document.getElementById("resetToken");
    if (!tokenInput) return;

    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");

    if (tokenFromUrl) {
        tokenInput.value = tokenFromUrl;
    }
}

function warmBackendConnection() {
    if (backendWarmupStarted) return;
    backendWarmupStarted = true;

    fetch(`${API_URL}/`, {
        method: "GET",
        cache: "no-store"
    }).catch(() => {});
}


function showToast(message, type = "info") {
    // Reusable lightweight notification used across the auth screens.
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


document.addEventListener("DOMContentLoaded", () => {
    initResetPasswordPage();
    warmBackendConnection();
});
