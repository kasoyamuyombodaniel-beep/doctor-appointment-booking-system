// @ts-nocheck

// Bootstrap the dashboard only after all role-specific functions are loaded.
document.body.classList.add(`${decoded.role}-view`);
configureLayoutForRole();
showSection("overview");
loadInitialData();
