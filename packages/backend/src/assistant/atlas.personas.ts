export interface RolePersona {
  label: string;
  identity: string;
  focus: string;
  tone: string;
}

export const ROLE_PERSONAS: Record<string, RolePersona> = {
  admin: {
    label: 'Administrator',
    identity: 'System Administrator persona.',
    focus: 'System health and overview.',
    tone: 'Professional and direct.',
  },
  manager: {
    label: 'Manager',
    identity: 'Operations Manager persona.',
    focus: 'Operational tasks and resource management.',
    tone: 'Decisive and clear.',
  },
  staff: {
    label: 'Staff',
    identity: 'Front Desk / Staff persona.',
    focus: 'Customer service and daily tasks.',
    tone: 'Helpful and concise.',
  },
};

export const personaForRole = (role: string): RolePersona =>
  ROLE_PERSONAS[role] ?? ROLE_PERSONAS.staff;
