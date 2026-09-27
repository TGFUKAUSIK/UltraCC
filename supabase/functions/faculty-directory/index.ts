/**
 * faculty-directory — Supabase Edge Function (Deno)
 *
 * Fetches the PUBLIC VIT Chennai faculty directory pages
 * (https://chennai.vit.ac.in/faculty/ + school pages) and returns a clean,
 * searchable JSON list of faculty. No authentication, no session, no VTOP —
 * the source site is public.
 *
 * TARGET: https://chennai.vit.ac.in (VIT Chennai official site)
 *
 * SECURITY:
 *   - No credentials/cookies involved — public pages only.
 *   - Only normalized faculty metadata is returned (name, designation,
 *     school, employee id, profile URL, photo URL). No private data.
 *   - Never logs page bodies.
 *
 * TLS: the public site serves a Sectigo-signed chain; we reuse the verified
 * USERTrust/Sectigo CA bundle (same one vtop-gateway ships) when the Deno
 * runtime supports `Deno.createHttpClient`, and fall back to the default
 * trust store otherwise (never disabling verification).
 */

// ---------------------------------------------------------------------------
// TLS — Sectigo chain (copied from vtop-gateway, verified against live certs)
// ---------------------------------------------------------------------------
const SECTIGO_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGEzCCA/ugAwIBAgIQfVtRJrR2uhHbdBYLvFMNpzANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTgx
MTAyMDAwMDAwWhcNMzAxMjMxMjM1OTU5WjCBjzELMAkGA1UEBhMCR0IxGzAZBgNV
BAgTEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UEBxMHU2FsZm9yZDEYMBYGA1UE
ChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFJTQSBEb21haW4g
VmFsaWRhdGlvbiBTZWN1cmUgU2VydmVyIENBMIIBIjANBgkqhkiG9w0BAQEFAAOC
AQ8AMIIBCgKCAQEA1nMz1tc8INAA0hdFuNY+B6I/x0HuMjDJsGz99J/LEpgPLT+N
TQEMgg8Xf2Iu6bhIefsWg06t1zIlk7cHv7lQP6lMw0Aq6Tn/2YHKHxYyQdqAJrkj
eocgHuP/IJo8lURvh3UGkEC0MpMWCRAIIz7S3YcPb11RFGoKacVPAXJpz9OTTG0E
oKMbgn6xmrntxZ7FN3ifmgg0+1YuWMQJDgZkW7w33PGfKGioVrCSo1yfu4iYCBsk
Haswha6vsC6eep3BwEIc4gLw6uBK0u+QDrTBQBbwb4VCSmT3pDCg/r8uoydajotY
uK3DGReEY+1vVv2Dy2A0xHS+5p3b4eTlygxfFQIDAQABo4IBbjCCAWowHwYDVR0j
BBgwFoAUU3m/WqorSs9UgOHYm8Cd8rIDZsswHQYDVR0OBBYEFI2MXsRUrYrhd+mb
+ZsF4bgBjWHhMA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMB0G
A1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAbBgNVHSAEFDASMAYGBFUdIAAw
CAYGZ4EMAQIBMFAGA1UdHwRJMEcwRaBDoEGGP2h0dHA6Ly9jcmwudXNlcnRydXN0
LmNvbS9VU0VSVHJ1c3RSU0FDZXJ0aWZpY2F0aW9uQXV0aG9yaXR5LmNybDB2Bggr
BgEFBQcBAQRqMGgwPwYIKwYBBQUHMAKGM2h0dHA6Ly9jcnQudXNlcnRydXN0LmNv
bS9VU0VSVHJ1c3RSU0FBZGRUcnVzdENBLmNydDAlBggrBgEFBQcwAYYZaHR0cDov
L29jc3AudXNlcnRydXN0LmNvbTANBgkqhkiG9w0BAQwFAAOCAgEAMr9hvQ5Iw0/H
ukdN+Jx4GQHcEx2Ab/zDcLRSmjEzmldS+zGea6TvVKqJjUAXaPgREHzSyrHxVYbH
7rM2kYb2OVG/Rr8PoLq0935JxCo2F57kaDl6r5ROVm+yezu/Coa9zcV3HAO4OLGi
H19+24rcRki2aArPsrW04jTkZ6k4Zgle0rj8nSg6F0AnwnJOKf0hPHzPE/uWLMUx
RP0T7dWbqWlod3zu4f+k+TY4CFM5ooQ0nBnzvg6s1SQ36yOoeNDT5++SR2RiOSLv
xvcRviKFxmZEJCaOEDKNyJOuB56DPi/Z+fVGjmO+wea03KbNIaiGCpXZLoUmGv38
sbZXQm2V0TP2ORQGgkE49Y9Y3IBbpNV9lXj9p5v//cWoaasm56ekBYdbqbe4oyAL
l6lFhd2zi+WJN44pDfwGF/Y4QA5C5BIG+3vzxhFoYt/jmPQT2BVPi7Fp2RBgvGQq
6jG35LWjOhSbJuMLe/0CjraZwTiXWTb2qHSihrZe68Zk6s+go/lunrotEbaGmAhY
LcmsJWTyXnW0OMGuf1pGg+pRyrbxmRE1a6Vqe8YAsOf4vmSyrcjC8azjUeqkk+B5
yOGBQMkKW+ESPMFgKuOXwIlCypTPRpgSabuY0MLTDXJLR27lk8QyKGOHQ+SwMj4K
00u/I5sUKUErmgQfky3xxzlIPK1aEn8=
-----END CERTIFICATE-----`;

const USERTRUST_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIF3jCCA8agAwIBAgIQAf1tMPyjylGoG7xkDjUDLTANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAw
MjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNV
BAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVU
aGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2Vy
dGlmaWNhdGlvbiBBdXRob3JpdHkwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK
AoICAQCAEmUXNg7D2wiz0KxXDXbtzSfTTK1Qg2HiqiBNCS1kCdzOiZ/MPans9s/B
3PHTsdZ7NygRK0faOca8Ohm0X6a9fZ2jY0K2dvKpOyuR+OJv0OwWIJAJPuLodMkY
tJHUYmTbf6MG8YgYapAiPLz+E/CHFHv25B+O1ORRxhFnRghRy4YUVD+8M/5+bJz/
Fp0YvVGONaanZshyZ9shZrHUm3gDwFA66Mzw3LyeTP6vBZY1H1dat//O+T23LLb2
VN3I5xI6Ta5MirdcmrS3ID3KfyI0rn47aGYBROcBTkZTmzNg95S+UzeQc0PzMsNT
79uq/nROacdrjGCT3sTHDN/hMq7MkztReJVni+49Vv4M0GkPGw/zJSZrM233bkf6
c0Plfg6lZrEpfDKEY1WJxA3Bk1QwGROs0303p+tdOmw1XNtB1xLaqUkL39iAigmT
Yo61Zs8liM2EuLE/pDkP2QKe6xJMlXzzawWpXhaDzLhn4ugTncxbgtNMs+1b/97l
c6wjOy0AvzVVdAlJ2ElYGn+SNuZRkg7zJn0cTRe8yexDJtC/QV9AqURE9JnnV4ee
UB9XVKg+/XRjL7FQZQnmWEIuQxpMtPAlR1n6BB6T1CZGSlCBst6+eLf8ZxXhyVeE
Hg9j1uliutZfVS7qXMYoCAQlObgOK6nyTJccBz8NUvXt7y+CDwIDAQABo0IwQDAd
BgNVHQ4EFgQUU3m/WqorSs9UgOHYm8Cd8rIDZsswDgYDVR0PAQH/BAQDAgEGMA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAFzUfA3P9wF9QZllDHPF
Up/L+M+ZBn8b2kMVn54CVVeWFPFSPCeHlCjtHzoBN6J2/FNQwISbxmtOuowhT6KO
VWKR82kV2LyI48SqC/3vqOlLVSoGIG1VeCkZ7l8wXEskEVX/JJpuXior7gtNn3/3
ATiUFJVDBwn7YKnuHKsSjKCaXqeYalltiz8I+8jRRa8YFWSQEg9zKC7F4iRO/Fjs
8PRF/iKz6y+O0tlFYQXBl2+odnKPi4w2r78NBc5xjeambx9spnFixdjQg3IM8WcR
iQycE0xyNN+81XHfqnHd4blsjDwSXWXavVcStkNr/+XeTWYRUc+ZruwXtuhxkYze
Sf7dNXGiFSeUHM9h4ya7b6NnJSFd5t0dCy5oGzuCr+yDZ4XUmFF0sbmZgIn/f3gZ
XHlKYC6SQK5MNyosycdiyA5d9zZbyuAlJQG03RoHnHcAP9Dc1ew91Pq7P8yF1m9/
qS3fuQL39ZeatTXaw2ewh0qpKJ4jjv9cJ2vhsE/zB+4ALtRZh8tSQZXq9EfX7mRB
VXyNWQKV3WKdwrnuWih0hKWbt5DHDAff9Yk2dDLWKMGwsAvgnEzDHNb842m1R0aB
L6KCq9NjRHDEjf8tM7qtj3u1cIiuPhnPQCjY/MiQu12ZIvVS5ljFH4gxQ+6IHdfG
jjxDah2nGN59PRbxYvnKkKj9
-----END CERTIFICATE-----`;

let httpClient: ReturnType<typeof Deno.createHttpClient> | null = null;
try {
  // @ts-ignore: Deno-specific API
  httpClient = Deno.createHttpClient({
    caCerts: [SECTIGO_INTERMEDIATE_CA, USERTRUST_ROOT_CA],
  });
} catch {
  httpClient = null;
}

const ORIGIN = 'https://chennai.vit.ac.in';

// Official VIT Chennai faculty directory — school-wise pages (URLs verified
// against the live chennai.vit.ac.in/faculty hub, 2026-08). Only pages that
// actually render `article.exad-post-grid-three` cards are listed.
const SCHOOLS: { id: string; name: string; sub: string; url: string }[] = [
  { id: 'all', name: 'All Faculty', sub: 'Aggregated across schools', url: '' },
  { id: 'scope', name: 'SCOPE', sub: 'Computer Science & Engineering', url: `${ORIGIN}/school-of-computer-science-and-engineering-scope-2/scope-faculty/` },
  { id: 'select', name: 'SELECT', sub: 'Electrical Engineering', url: `${ORIGIN}/school-of-electrical-engineering-select/select-faculty/` },
  { id: 'sense', name: 'SENSE', sub: 'Electronics Engineering', url: `${ORIGIN}/school-of-electronics-engineering-sense/sense-faculty/` },
  { id: 'smec', name: 'SMEC', sub: 'Mechanical Engineering', url: `${ORIGIN}/school-of-mechanical-engineering-smec/smec-faculty/` },
  { id: 'sas-physics', name: 'SAS — Physics', sub: 'Physics', url: `${ORIGIN}/school-of-advanced-sciences-sas-physics/sas-physics-faculty/` },
  { id: 'sas-maths', name: 'SAS — Mathematics', sub: 'Mathematics', url: `${ORIGIN}/school-of-advanced-sciences-sas-mathematics/sas-mathematics-faculty/` },
  { id: 'sas-chem', name: 'SAS — Chemistry', sub: 'Chemistry', url: `${ORIGIN}/school-of-advanced-sciences-sas-physics/sas-chemistry-faculty/` },
  { id: 'sbst', name: 'SBST', sub: 'Bio Sciences & Technology', url: `${ORIGIN}/school-of-bio-sciences-and-technology-sbst/sbst-faculty/` },
  { id: 'ssl', name: 'SSL', sub: 'Social Sciences & Languages', url: `${ORIGIN}/school-of-social-sciences-and-languages-ssl/ssl-faculty/` },
  { id: 'sce', name: 'SCE', sub: 'Civil Engineering', url: `${ORIGIN}/school-of-electrical-engineering-select/sce-civil-faculty/` },
  { id: 'vfit', name: 'V-FIT', sub: 'Fashion & Apparel Technology', url: `${ORIGIN}/school-of-electrical-engineering-select/vfit-faculty/` },
  { id: 'vitsol', name: 'VITSOL', sub: 'School of Law', url: `${ORIGIN}/vit-school-of-law-vitsol/vitsol-faculty/` },
  { id: 'vsmart', name: 'V-SMART', sub: 'Media, Arts & Technology', url: `${ORIGIN}/vit-school-of-media-arts-and-technology-v-smart/vsmart-faculty/` },
  { id: 'hrob', name: 'HR & OB', sub: 'HR & Organizational Behaviour', url: `${ORIGIN}/hr-and-ob-chennai-faculty/` },
];

interface FacultyMember {
  name: string;
  designation: string;
  schoolId: string;
  schoolName: string;
  employeeId: string;
  profileUrl: string;
  imageUrl: string;
  email: string;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

async function fetchHtml(url: string, redirects = 0): Promise<string> {
  if (redirects > 4) throw new Error('Too many redirects');
  const opts: RequestInit & { client?: unknown } = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  if (httpClient) opts.client = httpClient;
  const res = await fetch(url, opts);
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    const next = new URL(res.headers.get('location')!, url).toString();
    return fetchHtml(next, redirects + 1);
  }
  if (!res.ok) throw new Error(`Failed to load faculty page: ${res.status}`);
  return res.text();
}

/** Strip tags -> single-line text (regex-only; Deno has no DOM). */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parse one school page into faculty members (live-verified structure:
 *  article.exad-post-grid-three cards). */
/** Minimal HTML entity decode for the few entities VIT pages use. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function parseFacultyPage(html: string, schoolId: string, schoolName: string): FacultyMember[] {
  const out: FacultyMember[] = [];
  const seen = new Set<string>();

  const push = (f: FacultyMember) => {
    const key = f.employeeId || f.name;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  // NEW layout (live 2026): <article class="vit-person-card"> with
  //   a.vit-person-image (profile href + aria-label), img (employee id in URL),
  //   span.vit-designation, h3.vit-person-name, a.vit-view-profile.
  const cards = html.split(/<article\b[^>]*class=["'][^"']*vit-person-card[^"']*["'][^>]*>/i).slice(1);
  for (const card of cards) {
    const end = card.search(/<\/article>/i);
    const body = end >= 0 ? card.slice(0, end) : card;
    const name = decodeEntities(stripTags(body.match(/<h3\b[^>]*class=["'][^"']*vit-person-name[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || ''));
    if (!name) continue;
    const profileUrlRaw = body.match(/class=["'][^"']*vit-person-image[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1]
      || body.match(/class=["'][^"']*vit-view-profile[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1] || '';
    const designation = decodeEntities(stripTags(body.match(/class=["'][^"']*vit-designation[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || 'Faculty'));
    const img = body.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || '';
    const idMatch = img.match(/(?:uploads\/\d{4}\/\d{2}\/)(\d{3,})/);
    const employeeId = idMatch ? idMatch[1] : '';
    const email = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}/)?.[0] || '';
    const profileUrl = employeeId
      ? `https://directorycc.vit.ac.in/faculty/${employeeId}`
      : (profileUrlRaw.startsWith('http') ? profileUrlRaw : ORIGIN + profileUrlRaw);
    push({ name, designation, schoolId, schoolName, employeeId, profileUrl, imageUrl: img, email });
  }

  // LEGACY layout (live-verified): article.exad-post-grid-three cards.
  if (out.length === 0) {
    const legacyCards = html.split(/<article\b[^>]*class=["'][^"']*exad-post-grid-three[^"']*["'][^>]*>/i).slice(1);
    for (const card of legacyCards) {
      const end = card.search(/<\/article>/i);
      const body = end >= 0 ? card.slice(0, end) : card;
      const name = stripTags(body.match(/<a\b[^>]*class=["'][^"']*exad-post-grid-title[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
      if (!name) continue;
      const profileUrlRaw = body.match(/<a\b[^>]*class=["'][^"']*exad-post-grid-title[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1] || '';
      const designation = stripTags(body.match(/class=["'][^"']*exad-post-grid-category[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || 'Faculty');
      const img = body.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || '';
      const idMatch = img.match(/(?:uploads\/\d{4}\/\d{2}\/)(\d{3,})/);
      const employeeId = idMatch ? idMatch[1] : '';
      const profileUrl = employeeId
        ? `https://directorycc.vit.ac.in/faculty/${employeeId}`
        : (profileUrlRaw.startsWith('http') ? profileUrlRaw : ORIGIN + profileUrlRaw);
      push({ name, designation, schoolId, schoolName, employeeId, profileUrl, imageUrl: img, email: '' });
    }
  }

  // Fallback: legacy member-item layout (vc_col-sm-3/4, h3/h4 names).
  if (out.length === 0) {
    const legacy = html.split(/<div\b[^>]*class=["'][^"']*(?:member-item|staff-member|vc_col-sm-[34])[^"']*["'][^>]*>/i).slice(1);
    for (const block of legacy) {
      const end = block.search(/<\/div>/i);
      const body = end >= 0 ? block.slice(0, end) : block;
      const name = stripTags(body.match(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/i)?.[1] || '');
      if (!name) continue;
      const designation = stripTags(body.match(/<h[45]\b[^>]*>([\s\S]*?)<\/h[45]>/i)?.[1] || 'Faculty');
      const img = body.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || '';
      const email = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}/)?.[0] || '';
      const empId = body.match(/Employee ID\s*[:\s]*(\d+)/i)?.[1] || '';
      const profileUrl = empId ? `https://directorycc.vit.ac.in/faculty/${empId}` : '';
      push({ name, designation, schoolId, schoolName, employeeId: empId, profileUrl, imageUrl: img, email });
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  try {
    const url = new URL(req.url);
    const school = url.searchParams.get('school') || 'all';

    if (req.method === 'GET' && url.pathname.endsWith('/schools')) {
      return new Response(JSON.stringify({ success: true, schools: SCHOOLS }), {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const target = SCHOOLS.find((s) => s.id === school);
    if (school === 'all' || !target) {
      // Aggregate the real school pages in parallel; one slow/failing school
      // must not sink the whole directory (Promise.allSettled).
      const targets = SCHOOLS.filter((s) => s.id !== 'all');
      const settled = await Promise.allSettled(
        targets.map(async (t) => {
          const html = await fetchHtml(t.url);
          return parseFacultyPage(html, t.id, t.name);
        })
      );
      const faculties: FacultyMember[] = [];
      let loadedSchools = 0;
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          faculties.push(...r.value);
          loadedSchools += 1;
        }
      }
      return new Response(JSON.stringify({ success: true, school: SCHOOLS[0], faculties, loadedSchools, totalSchools: targets.length }), {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const html = await fetchHtml(target.url);
    const faculties = parseFacultyPage(html, target.id, target.name);
    return new Response(JSON.stringify({ success: true, school: target, faculties, loadedSchools: 1, totalSchools: 1 }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: message, faculties: [] }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
});
