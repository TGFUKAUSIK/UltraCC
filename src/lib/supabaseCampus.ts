import { SUPABASE_URL, ANON_KEY } from './edgeFetch';

function headers(extra?: Record<string, string>) {
  return { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, ...extra };
}

export interface StudyGroup {
  id: number;
  course: string;
  assessment: string;
  topic: string;
  meeting_time: string;
  location: string;
  group_size: number;
  display_name: string;
  member_count: number;
  created_at: string;
}

export async function fetchStudyGroups(): Promise<StudyGroup[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/study_groups_public?select=*&order=created_at.desc&limit=100`, { headers: headers() });
  if (!response.ok) throw new Error('Study groups are temporarily unavailable');
  return response.json();
}

export async function createStudyGroup(input: {
  course: string; assessment: string; topic: string; meeting_time: string;
  location: string; group_size: number; display_name: string; owner_token_hash: string;
}): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/study_groups`, {
    method: 'POST', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Could not create the study group');
}

export async function joinStudyGroup(groupId: number, displayName: string, memberToken: string): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_study_group`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ p_group_id: groupId, p_display_name: displayName, p_member_token: memberToken }),
  });
  if (!response.ok) throw new Error('Could not join the study group');
  return Boolean(await response.json());
}

export async function leaveStudyGroup(groupId: number, memberToken: string): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/leave_study_group`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ p_group_id: groupId, p_member_token: memberToken }),
  });
  if (!response.ok) throw new Error('Could not leave the study group');
  return Boolean(await response.json());
}

export function newCampusCapabilityToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashCampusCapabilityToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
