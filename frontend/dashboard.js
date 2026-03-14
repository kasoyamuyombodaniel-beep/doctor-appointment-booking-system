/*
Dashboard logic is now split into smaller files for easier study:

- dashboard-core.js
  Shared state, JWT decoding, role-based layout, profile, stats, and bootstrap helpers.

- dashboard-data.js
  Data loading and CRUD flows for appointments, availability, doctors, and patients.

- dashboard-panels.js
  Rendering functions, inbox behavior, medical record preview/download, helpers, and UI utilities.

- dashboard-init.js
  Final startup call that runs after all dashboard functions are loaded.

dashboard.html includes these files in order.
This file is intentionally kept as a guide because it used to contain the full dashboard logic.
*/
