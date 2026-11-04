// Job roles shown in the app, and the access level each one gets.
//   employee: own records only            (technical, non_technical, sales)
//   manager : themselves + direct reports (team_lead, manager)
//   boss    : everything
export const ROLES = ['technical', 'non_technical', 'sales', 'team_lead', 'manager', 'boss'];

const LEVELS = {
  technical: 'employee',
  non_technical: 'employee',
  sales: 'employee',
  team_lead: 'manager',
  manager: 'manager',
  boss: 'boss',
};

export const levelOf = (role) => LEVELS[role] ?? 'employee';
export const SUPERVISOR_ROLES = ROLES.filter((r) => levelOf(r) !== 'employee');
