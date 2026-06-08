export const Role = {
  SUPER_ADMIN: "SUPER_ADMIN",
  TENANT_ADMIN: "TENANT_ADMIN",
  ENROLLER: "ENROLLER",
  INVIGILATOR: "INVIGILATOR",
  VIEWER: "VIEWER",
} as const;

/** Union of allowed role strings (for JWT / RBAC). */
export type RoleName = (typeof Role)[keyof typeof Role];
