// Where a result / enquiry notification is delivered.
//
// Nothing is hard-coded here, so this build can never mail another school's
// inbox. Resolution order:
//   1. NEXT_PUBLIC_RESULT_EMAIL_RECIPIENTS — comma, space or semicolon separated
//   2. jmis_settings.adminEmail + jmis_settings.additionalemails (Settings page)
// An empty list is returned when neither is configured; emailNotificationService
// then reports "No email recipients configured" instead of guessing a recipient.

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function parseRecipients(value) {
  const seen = new Set();
  const out = [];
  for (const raw of String(value || '').split(/[\s,;]+/)) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export async function resolveResultRecipients(supabase) {
  const recipients = parseRecipients(process.env.NEXT_PUBLIC_RESULT_EMAIL_RECIPIENTS);
  const seen = new Set(recipients);

  try {
    const { data, error } = await supabase
      .from('jmis_settings')
      .select('adminEmail, additionalemails')
      .limit(1);
    if (!error && data && data.length) {
      const configured = [data[0].adminEmail || '', data[0].additionalemails || ''].join(' ');
      for (const email of parseRecipients(configured)) {
        if (seen.has(email)) continue;
        seen.add(email);
        recipients.push(email);
      }
    }
  } catch (error) {
    console.warn('⚠️ [ResultRecipients] Could not read admin emails from settings:', error && error.message ? error.message : error);
  }

  return recipients;
}
