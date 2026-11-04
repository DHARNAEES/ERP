// Job roles, in the order they appear in dropdowns. `level` (employee / manager / boss) is what the
// server uses for access and arrives on `me.level`; these labels are only for display.
export const ROLE_LABELS = {
  technical: 'Technical',
  non_technical: 'Non-Technical',
  sales: 'Sales',
  team_lead: 'Team Lead',
  manager: 'Manager',
  boss: 'Boss',
};

export const roleLabel = (role) => ROLE_LABELS[role] ?? role;

// Roles that can have people reporting to them.
export const SUPERVISOR_ROLES = ['team_lead', 'manager', 'boss'];
