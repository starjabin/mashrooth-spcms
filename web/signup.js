const translations = {
  'Skip to content': 'تخطَّ إلى المحتوى',
  'Sign in': 'تسجيل الدخول',
  'START WITH YOUR ORGANIZATION': 'ابدأ بمؤسستك',
  'One place for the work behind every contract.': 'مكان واحد لكل ما يتعلق بالعقد.',
  'Tell us about your team. We’ll discuss the right workspace, purchase terms and activation with you before any payment.': 'أخبرنا عن فريقك. سنناقش مساحة العمل المناسبة وشروط الشراء والتفعيل قبل أي دفعة.',
  'Send your request': 'أرسل طلبك',
  'Share your organization and expected team size.': 'عرّفنا بمؤسستك وحجم فريقك المتوقع.',
  'Review your proposal': 'راجع العرض',
  'Confirm scope, pricing and terms with Mashrooth.': 'اتفق على النطاق والسعر والشروط مع مشروط.',
  'Activate your workspace': 'فعّل مساحة عملك',
  'Accounts are provisioned after the purchase is agreed.': 'تُجهّز الحسابات بعد الاتفاق على الشراء.',
  'No card details are collected on this page. Sending a request does not create an account or start a subscription.': 'لا نجمع بيانات بطاقتك على هذه الصفحة. إرسال الطلب لا ينشئ حساباً ولا يبدأ اشتراكاً.',
  'PURCHASE INQUIRY': 'طلب شراء',
  'Sign up for a workspace': 'سجّل اهتمامك بمساحة عمل',
  'Choose the workspace you’re interested in. We’ll contact you to confirm availability and a quote.': 'اختر مساحة العمل التي تناسبك. سنتواصل معك لتأكيد التوفر وتقديم عرض سعر.',
  'Checking purchase request availability…': 'جارٍ التحقق من إتاحة طلبات الشراء…',
  'Which workspace fits your team?': 'ما مساحة العمل المناسبة لفريقك؟',
  'Team workspace': 'مساحة عمل للفريق',
  'For a single organization managing shared project and contract records.': 'لمؤسسة واحدة تدير سجلات المشاريع والعقود مع فريقها.',
  'Enterprise discussion': 'حل مخصص للمؤسسات',
  'For larger teams that need a tailored scope and rollout plan.': 'لفرق أكبر تحتاج إلى نطاق وخطة إطلاق مخصصين.',
  'Your name': 'اسمك',
  'Work email': 'البريد الإلكتروني للعمل',
  'Organization name': 'اسم المؤسسة',
  'Estimated number of users': 'عدد المستخدمين المتوقع',
  'Select a range': 'اختر العدد',
  '1–5 users': '١–٥ مستخدمين',
  '6–20 users': '٦–٢٠ مستخدماً',
  '21–100 users': '٢١–١٠٠ مستخدم',
  '101+ users': 'أكثر من ١٠٠ مستخدم',
  'I agree to be contacted about this workspace purchase request. Do not include confidential project or contract details.': 'أوافق على التواصل معي بشأن طلب شراء مساحة العمل. يرجى عدم إدراج تفاصيل مشاريع أو عقود سرية.',
  'Request purchase options': 'اطلب خيارات الشراء',
  'No payment is taken now. Pricing, billing and access will be confirmed separately. Already have an account?': 'لن تُحصّل أي دفعة الآن. سيُؤكد السعر والفوترة والوصول بشكل منفصل. هل لديك حساب؟',
  'Projects, contracts and obligations in view.': 'المشاريع والعقود والالتزامات أمامك بوضوح.'
};

const translatedNodes = [];
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode;
  const key = node.nodeValue.trim();
  if (Object.hasOwn(translations, key)) translatedNodes.push({ node, english: node.nodeValue, key });
}
const languageButton = document.getElementById('language-toggle');
languageButton.addEventListener('click', () => {
  const ar = document.documentElement.lang !== 'ar';
  for (const { node, english, key } of translatedNodes) node.nodeValue = ar ? english.replace(key, translations[key]) : english;
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  document.title = ar ? 'الاشتراك في مشروط | طلب شراء مساحة عمل' : 'Sign up for Mashrooth | Workspace purchase request';
  languageButton.textContent = ar ? 'English' : 'العربية';
  languageButton.setAttribute('aria-label', ar ? 'Switch to English' : 'Switch to Arabic');
  languageButton.setAttribute('aria-pressed', String(ar));
  document.querySelector('.signup-timeline').setAttribute('aria-label', ar ? 'خطوات الشراء' : 'Purchase steps');
  const availability = document.getElementById('availability');
  if (availability.dataset.state === 'closed') availability.textContent = ar ? 'طلبات الشراء غير مفتوحة حالياً. يرجى العودة قريباً.' : 'Purchase requests are not open yet. Please check back soon.';
  if (availability.dataset.state === 'unavailable') availability.textContent = ar ? 'خدمة الطلبات غير متاحة حالياً. يرجى العودة لاحقاً.' : 'The request service is unavailable. Please check back later.';
  try { sessionStorage.setItem('mashrooth-language', ar ? 'ar' : 'en'); } catch { /* Storage is optional. */ }
});
try { if (sessionStorage.getItem('mashrooth-language') === 'ar') languageButton.click(); } catch { /* Storage is optional. */ }

const form = document.getElementById('purchase-form');
const status = document.getElementById('form-status');
const submitButton = form.querySelector('[type="submit"]');
const availability = document.getElementById('availability');
submitButton.disabled = true;
fetch('/api/purchase-requests', { signal: AbortSignal.timeout(10000) })
  .then(async response => response.ok ? response.json() : { open: false })
  .then(({ open }) => {
    if (open) { submitButton.disabled = false; availability.className = 'availability open'; availability.textContent = ''; return; }
    availability.dataset.state = 'closed';
    availability.className = 'availability closed';
    availability.textContent = document.documentElement.lang === 'ar'
      ? 'طلبات الشراء غير مفتوحة حالياً. يرجى العودة قريباً.'
      : 'Purchase requests are not open yet. Please check back soon.';
  })
  .catch(() => {
    availability.dataset.state = 'unavailable';
    availability.className = 'availability closed';
    availability.textContent = document.documentElement.lang === 'ar'
      ? 'خدمة الطلبات غير متاحة حالياً. يرجى العودة لاحقاً.'
      : 'The request service is unavailable. Please check back later.';
  });
form.addEventListener('input', () => { status.textContent = ''; status.className = 'form-status'; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitButton.disabled) return;
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const payload = {
    contact_name: values.get('contact_name'), work_email: values.get('work_email'),
    organization_name: values.get('organization_name'), seat_range: values.get('seat_range'),
    plan: values.get('plan'), contact_consent: values.get('contact_consent') === 'on',
    website: values.get('website') || ''
  };
  submitButton.disabled = true;
  status.textContent = document.documentElement.lang === 'ar' ? 'جارٍ إرسال طلبك…' : 'Sending your request…';
  status.className = 'form-status';
  try {
    const response = await fetch('/api/purchase-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Unavailable');
    form.reset();
    status.className = 'form-status success';
    status.textContent = document.documentElement.lang === 'ar'
      ? 'تم استلام طلبك. لا توجد دفعة أو اشتراك في هذه المرحلة.'
      : 'Request received. No payment or subscription has started.';
  } catch {
    status.className = 'form-status error';
    status.textContent = document.documentElement.lang === 'ar'
      ? 'تعذّر إرسال الطلب الآن. يرجى المحاولة لاحقاً.'
      : 'We could not send your request. Please try again later.';
  } finally { submitButton.disabled = false; }
});
