// The illustration is a local preview only; no customer data is loaded.
const tabs = Array.from(document.querySelectorAll('.preview-tabs [role="tab"]'));

function selectPreview(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectPreview(tab));
  tab.addEventListener('keydown', event => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + delta + tabs.length) % tabs.length;
    selectPreview(tabs[index], true);
  });
}

// Translate text nodes so the semantic structure, decorative icons and tab controls stay intact.
const arabic = {
  'Skip to content': 'تخطَّ إلى المحتوى',
  'Workspace': 'مساحة العمل',
  'How it works': 'كيف يعمل',
  'Foundation': 'الأساس',
  'Purchase': 'الشراء',
  'Sign in': 'تسجيل الدخول',
  'Get access': 'اطلب الوصول',
  'PROJECTS · CONTRACTS · OBLIGATIONS': 'المشاريع · العقود · الالتزامات',
  'The work behind a contract,': 'كل ما يتعلق بالعقد،',
  'all in view.': 'أمامك بوضوح.',
  'Bring project records, claims and key dates into one place. Help your team see what needs attention, who is responsible, and what changed.': 'اجمع سجلات المشاريع والمطالبات والمواعيد المهمة في مكان واحد. ساعد فريقك على معرفة ما يحتاج إلى متابعة، ومن المسؤول عنه، وما الذي تغيّر.',
  'Request a workspace': 'اطلب مساحة عمل',
  'Explore the workspace': 'استكشف مساحة العمل',
  'Private pilot · Purchase requests are reviewed before activation': 'تجربة خاصة · تُراجع طلبات الشراء قبل تفعيل الحسابات',
  'ILLUSTRATION': 'تصوّر توضيحي',
  'WORKSPACE / OVERVIEW': 'مساحة العمل / نظرة عامة',
  'YOUR WORKSPACE': 'مساحة عملك',
  'A clearer view of your work.': 'رؤية أوضح لعملك.',
  'Projects': 'المشاريع',
  'Contracts': 'العقود',
  'Obligations': 'الالتزامات',
  'PROJECT REGISTER': 'سجل المشاريع',
  'CONTRACT REGISTER': 'سجل العقود',
  'OBLIGATION REGISTER': 'سجل الالتزامات',
  'Keep the full picture close.': 'الصورة الكاملة بين يديك.',
  'Find the terms that matter.': 'اعثر على البنود المهمة.',
  'Know what comes next.': 'اعرف الخطوة التالية.',
  'Scope, dates and ownership in a shared place for your team.': 'النطاق والمواعيد والمسؤوليات في مساحة مشتركة لفريقك.',
  'Track important details and connect each contract to its project.': 'تابع التفاصيل المهمة واربط كل عقد بمشروعه.',
  'Put dates, owners and source references together for review.': 'اجمع المواعيد والمسؤولين والمراجع للمراجعة.',
  'Project details': 'تفاصيل المشروع',
  'Linked records': 'السجلات المرتبطة',
  'Contract records': 'سجلات العقود',
  'Related claims': 'المطالبات المرتبطة',
  'Upcoming dates': 'المواعيد القادمة',
  'Assigned owners': 'المسؤولون المكلّفون',
  'IN VIEW': 'واضح',
  'Illustrative interface · No client data': 'واجهة توضيحية · بلا بيانات عملاء',
  'MADE FOR THE DETAILS': 'صُمّم للاهتمام بالتفاصيل',
  'SCROLL TO EXPLORE ↓': 'مرّر للاستكشاف ↓',
  'ONE SHARED VIEW': 'صورة واحدة مشتركة',
  'From the first record to the next decision.': 'من أول سجل إلى القرار التالي.',
  'Project teams work across files, dates and decisions. Mashrooth gives those moving parts a common home so people can review the same record and follow up with context.': 'تعمل فرق المشاريع عبر الملفات والمواعيد والقرارات. يجمع مشروط هذه الأجزاء في مكان مشترك ليطّلع الجميع على السجل نفسه ويتابعوا العمل بسياقه.',
  '01 / Organize': '01 / تنظيم',
  '02 / Review': '02 / مراجعة',
  '03 / Follow through': '03 / متابعة',
  'THE WORKSPACE': 'مساحة العمل',
  'A place for the work that surrounds every contract.': 'مكان لكل عمل يحيط بالعقد.',
  'Keep the information your team uses to plan, review and act together.': 'اجمع المعلومات التي يستخدمها فريقك للتخطيط والمراجعة والعمل معاً.',
  '01 / RECORD': '01 / تسجيل',
  '02 / REVIEW': '02 / مراجعة',
  '03 / FOLLOW UP': '03 / متابعة',
  '04 / UNDERSTAND': '04 / فهم',
  'Projects & contracts': 'المشاريع والعقود',
  'Claims & risks': 'المطالبات والمخاطر',
  'Dates & obligations': 'المواعيد والالتزامات',
  'Procurement & local content': 'المشتريات والمحتوى المحلي',
  'Keep project details, contract values, dates and status together in organization-scoped registers.': 'احتفظ بتفاصيل المشاريع وقيم العقود والمواعيد والحالات في سجلات خاصة بمؤسستك.',
  'Capture issues, claims and references so the right people have context for their review.': 'سجّل المشكلات والمطالبات والمراجع ليصل السياق إلى الأشخاص المعنيين بالمراجعة.',
  'Record due dates, responsible people and source references so upcoming work stays visible.': 'سجّل مواعيد الاستحقاق والمسؤولين والمراجع لتبقى الأعمال القادمة واضحة.',
  'Bring procurement items and local content figures into the project record for team review.': 'أدرج بنود المشتريات وأرقام المحتوى المحلي في سجل المشروع لمراجعة الفريق.',
  'WORK TOGETHER': 'العمل معاً',
  'More context at every handoff.': 'سياق أوضح عند كل تسليم.',
  'From a project overview to a specific obligation, follow the record through the work your team already does. Make it easier to spot what needs a decision next.': 'من نظرة عامة على المشروع إلى التزام محدد، تابع السجل خلال عمل فريقك اليومي. اعرف بسهولة ما يحتاج إلى قرار تالٍ.',
  'Open the workspace': 'افتح مساحة العمل',
  'Start with the project': 'ابدأ بالمشروع',
  'Keep its details, status and related records in one view.': 'اجمع تفاصيله وحالته وسجلاته المرتبطة في مكان واحد.',
  'Connect the contract': 'اربط العقد',
  'Link terms, claims and risks to the right project.': 'اربط البنود والمطالبات والمخاطر بالمشروع المناسب.',
  'Follow the obligation': 'تابع الالتزام',
  'Capture a due date, owner and the source behind it.': 'سجّل موعد الاستحقاق والمسؤول والمصدر المرتبط به.',
  'THE FOUNDATION': 'الأساس',
  'Built for shared work with clear boundaries.': 'مساحة للعمل المشترك بحدود واضحة.',
  'Access and record changes are designed around the organization and the people who work within it.': 'صُمم الوصول إلى السجلات وتعديلها وفق المؤسسة والأشخاص العاملين فيها.',
  'Organization access': 'صلاحيات المؤسسة',
  'Roles for your team': 'أدوار الفريق',
  'Record history': 'سجل التغييرات',
  'Records are scoped to an organization, with membership checked before access to its workspace.': 'ترتبط السجلات بمؤسسة محددة، ويُتحقق من العضوية قبل الدخول إلى مساحتها.',
  'Separate viewing, editing and administration responsibilities with role-based permissions.': 'حدّد مسؤوليات العرض والتعديل والإدارة بصلاحيات تعتمد على الأدوار.',
  'Changes are recorded so authorized team members can review what happened.': 'تُسجّل التغييرات ليتمكن أعضاء الفريق المخوّلون من مراجعتها.',
  'AI analysis is optional and disabled until data processing is approved. Hosting location and compliance certifications are not represented as verified.': 'التحليل بالذكاء الاصطناعي اختياري ومعطّل حتى الموافقة على معالجة البيانات. لا نقدّم موقع الاستضافة أو شهادات الامتثال على أنها معتمدة.',
  'PRIVATE PILOT': 'تجربة خاصة',
  'Ready to see your work in one place?': 'هل أنت مستعد لرؤية عملك في مكان واحد؟',
  'Request a workspace for your organization. We’ll discuss your plan, pricing and activation before any payment. Already have an account?': 'اطلب مساحة عمل لمؤسستك. سنناقش الخطة والسعر والتفعيل قبل أي دفعة. هل لديك حساب؟',
  'Projects, contracts and obligations in view.': 'المشاريع والعقود والالتزامات أمامك بوضوح.'
};

const translatedNodes = [];
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode;
  const key = node.nodeValue.trim();
  if (Object.hasOwn(arabic, key)) translatedNodes.push({ node, english: node.nodeValue, key });
}

const languageButton = document.getElementById('language-toggle');
languageButton.addEventListener('click', () => {
  const isArabic = document.documentElement.lang !== 'ar';
  for (const { node, english, key } of translatedNodes) {
    node.nodeValue = isArabic ? english.replace(key, arabic[key]) : english;
  }
  document.documentElement.lang = isArabic ? 'ar' : 'en';
  document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
  document.title = isArabic ? 'مشروط | كل ما يتعلق بالعقد أمامك بوضوح' : 'Mashrooth | Keep the work behind every contract in view';
  languageButton.textContent = isArabic ? 'English' : 'العربية';
  languageButton.setAttribute('aria-pressed', String(isArabic));
  languageButton.setAttribute('aria-label', isArabic ? 'Switch to English' : 'Switch to Arabic');
  document.querySelector('nav[aria-label]').setAttribute('aria-label', isArabic ? 'التنقل الرئيسي' : 'Main navigation');
  document.querySelector('.preview-tabs').setAttribute('aria-label', isArabic ? 'أقسام مساحة العمل التوضيحية' : 'Workspace preview areas');
  document.querySelector('.showcase').setAttribute('aria-label', isArabic ? 'تصوّر توضيحي لمساحة العمل' : 'Illustrative workspace preview');
  document.querySelector('.overview-steps').setAttribute('aria-label', isArabic ? 'أقسام مساحة العمل' : 'Workspace areas');
  try { sessionStorage.setItem('mashrooth-language', isArabic ? 'ar' : 'en'); } catch { /* Storage is optional. */ }
});
try { if (sessionStorage.getItem('mashrooth-language') === 'ar') languageButton.click(); } catch { /* Storage is optional. */ }
