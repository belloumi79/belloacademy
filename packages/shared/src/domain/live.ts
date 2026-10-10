/** Classes virtuelles (Jitsi Meet) : statuts, rôles de participant, règles d'accès. */

export const LIVE_SESSION_STATUSES = ["SCHEDULED", "LIVE", "ENDED", "CANCELLED"] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

export const LIVE_SESSION_STATUS_LABELS: Record<LiveSessionStatus, string> = {
  SCHEDULED: "Programmée",
  LIVE: "En cours",
  ENDED: "Terminée",
  CANCELLED: "Annulée",
};

export const LIVE_PARTICIPANT_ROLES = ["HOST", "MODERATOR", "PARTICIPANT"] as const;
export type LiveParticipantRole = (typeof LIVE_PARTICIPANT_ROLES)[number];

export const LIVE_PARTICIPANT_ROLE_LABELS: Record<LiveParticipantRole, string> = {
  HOST: "Animateur",
  MODERATOR: "Modérateur",
  PARTICIPANT: "Participant",
};

export const LIVE_PROVIDERS = ["JITSI"] as const;
export type LiveProvider = (typeof LIVE_PROVIDERS)[number];

/** Un identifiant de salle Jitsi doit être non devinable : on impose un format strict. */
export const JITSI_ROOM_PATTERN = /^[a-z0-9]{8,20}-[a-z0-9]{12,32}$/;

export function isValidJitsiRoomName(room: string): boolean {
  return JITSI_ROOM_PATTERN.test(room);
}

export function buildJitsiRoomName(courseId: string, randomToken: string): string {
  const coursePart = courseId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 20) || "session";
  return `${coursePart}-${randomToken.toLowerCase()}`;
}

/**
 * Règle d'accès à une classe virtuelle. L'objet est volontairement explicite afin
 * que la décision soit testable indépendamment de la couche HTTP.
 */
export type LiveAccessDecision =
  | { allowed: true; role: LiveParticipantRole; reason: "staff" | "instructor" | "enrolled" }
  | { allowed: false; reason: "not_authenticated" | "not_enrolled" | "cancelled" | "ended" | "other_tenant" };

export type LiveAccessInput = {
  isAuthenticated: boolean;
  isSameTenant: boolean;
  isOrgStaff: boolean;
  isCourseInstructor: boolean;
  isEnrolled: boolean;
  sessionStatus: LiveSessionStatus;
};

export function decideLiveAccess(input: LiveAccessInput): LiveAccessDecision {
  if (!input.isAuthenticated) return { allowed: false, reason: "not_authenticated" };
  if (!input.isSameTenant) return { allowed: false, reason: "other_tenant" };
  if (input.sessionStatus === "CANCELLED") return { allowed: false, reason: "cancelled" };
  if (input.sessionStatus === "ENDED") return { allowed: false, reason: "ended" };
  if (input.isCourseInstructor) return { allowed: true, role: "HOST", reason: "instructor" };
  if (input.isOrgStaff) return { allowed: true, role: "MODERATOR", reason: "staff" };
  if (input.isEnrolled) return { allowed: true, role: "PARTICIPANT", reason: "enrolled" };
  return { allowed: false, reason: "not_enrolled" };
}

export type LiveSessionSummary = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  status: LiveSessionStatus;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  hostName: string | null;
  canJoin: boolean;
  joinRole: LiveParticipantRole | null;
};
