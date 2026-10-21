# Full Production Readiness Audit

**المشروع:** `almarhabi/almarhabi.github.io` — **التاريخ:** 2026-10-21.

**نطاق الدليل:** نتائج محلية فعلية بعد دمج الإصلاحات، بتاريخ المراجعة. لا يُستنتج منها نجاح GitHub-hosted CI أو نشر Pages أو صحة إعدادات الخدمات الحية. تتبع نتائج الاختبارات أسماء ملفاتها ووحدة عد كل مجموعة؛ لا تُجمع fixtures الداخلية كأنها اختبارات مستقلة.

**اعتماد الإصدار النهائي قيد الاستكمال:** المجموعات أدناه لها تشغيلات محلية ناجحة موثقة، لكن إعادة التحقق الموحدة بعد تجميد آخر مصدر، ثم commit وremote CI وPages deployment، تُسجّل بواسطة مسؤول الإصدار. لا تمثل هذه الوثيقة موافقة على نشر لم يحدث بعد.

أُعيد التحقق المحلي بعد تثبيت الاعتماديات من lockfiles؛ نجحت **31 مجموعة تنفيذ نهائية** إلى جانب Python40 وفحوص المصدر والتبعيات. التفاصيل القابلة للقراءة آليًا في [verification-results.json](verification-results.json).

| دليل التحقق | النتيجة |
|---|---|
| مصدر الواجهة المحلي المفحوص | `index.html` SHA256: `21da22ef247da619a821aff84403558e45e3d0fe9cc777950f96e28d8e939da8`؛ ليس commit نهائيًا أو دليل نشر. |
| إعادة التحقق المحلية الموحدة بعد تجميد المصدر | قيد تسجيل مسؤول الإصدار؛ النتائج التفصيلية هي أدلة تشغيلات المجموعات وليست ادعاء نجاح remote CI. |
| Commit / remote CI / Pages deployment | الفحوص المحلية النهائية نجحت على بصمة المصدر أعلاه؛ متابعة النشر عن بعد لم تُسجل بعد في هذا السجل. |
| Install / dependencies | `npm ci` نظيف في `tools/runner` و`tools/audit`؛ `npm audit` بلا findings في كليهما وقت الفحص. pip26.2.2 و13 dependency اختبار مثبتة بإصدارات محددة و`pip check` نجحت؛ bootstrap بلا Firebase CLI. |
| Syntax / lint / shell / workflows | parsing لكل JavaScript وPython، correctness lint، CSP hash check، `bash -n` وactionlint نجحت. لا TypeScript أو build compiler في هذا المشروع. |
| Python + محرك Anki فعلي | **40/40**، بلا skip عند تثبيت dependency الاختبار وبلا ResourceWarning. |
| AI والمنطق والتزامن | regressions **14/14**، concurrency **16/16**، boundaries **9/9**، loader **6/6**، tabs **3/3**، integration **6/6**. |
| الحالة والتخزين والوقت | regressions **7/7**، queue **4/4**، browser **7/7**، wipe **8/8**، errors **8/8**، fuzz **101/101**، clock **7/7** وclock-browser **4/4**. |
| المتصفحات والموارد | frontend: Chromium/Firefox/WebKit **13/13 لكل محرك**؛ axe **21/21**؛ media **20/20**؛ المكتبات الفعلية وPDF workers **12/12 Chromium و12/12 WebKit**. |
| الأمن / Firebase emulator | XSS/state probes **8/8**، Worker **21/21**، bridge **8/8**، GAS client **4/4**؛ config **4/4**؛ harness JAR حقيقي **27/27** = قواعد16 + SDK epochs9 + long-poll2، دون Firebase CLI. |
| العامل وطابور Git | **14/14** بما فيها عملية Chromium حقيقية وGit remote مؤقت وسباق وصول مهمة أثناء الحفظ. |
| القياس المحلي للأداء | موثق مع كل العينات وSHA256 في [PERFORMANCE.md](PERFORMANCE.md)؛ يخص بصمة المصدر المجمد أعلاه؛ الفروق والنطاقات المتداخلة لا تثبت تحسن سرعة أو تراجعًا ماديًا. |

## 1. Executive Summary

التطبيق واجهة عربية ساكنة بـ HTML/CSS/JavaScript، بقاعدة حالة محلية وFirebase Realtime Database اختيارية، وتكاملات Kimi وGoogle Drive وGitHub Actions. لا يستخدم framework frontend، أو TypeScript، أو backend دائمًا، أو نظام حسابات. عامل Node يفتح الصفحة نفسها في Chromium؛ وPython يبني ملفات Anki باستعمال SQLite وZIP من المكتبة القياسية. وصف البنية والتشغيل في [README](../README.md).

شملت المراجعة المصدر، مدخلات التخزين والنسخ الاحتياطية، المزامنة والـ epochs، جلسات المذاكرة، التكاملات المولّدة، النقل الشبكي، طابور ANKI، العامل، التبعيات وCI، وأهم الرحلات على ثلاثة محركات متصفح. استُخدمت بيانات مصطنعة ومعزولة وحقن أعطال متعمد. لم تُقرأ أو تُعدّل بيانات مستخدم فعلية، ولم تُنفّذ طلبات AI مدفوعة أو عمليات كتابة على الخدمات الإنتاجية ضمن الاختبارات المعزولة.

ظهرت أخطاء حقيقية تتجاوز المظهر: XSS من بيانات مستوردة، prototype pollution، استبدال وجهة المزامنة دون تأكيد، فقد تعديلات أثناء reset، تعطل عند قيم تاريخ/بيانات مشوهة، مهام عالقة بعد موت العامل، بطاقات MCQ بخيارات مكررة، تعطل إعداد Worker المولّد، وتسرب موارد وcredentials من بيئة العامل. تسرد الأقسام التالية السبب والسيناريو والإصلاح والدليل بدل افتراض سلامة التنفيذ الموجود.

**تصنيف الإطلاق العام الحالي: NOT READY.** الفحوص المحلية المذكورة نجحت، لكن إعدادات Firebase الحية وصلاحيات التكاملات والنشر الفعلي واشتراطات خصوصية فرع المهام العام لم تُتحقق تشغيليًا. نموذج bearer capability مقصود للاستخدام الشخصي والمشاركة بالمفتاح؛ غياب الحسابات ليس ثغرة مستقلة في هذا النطاق. إذا كان الإطلاق يحتاج عضويات وأدوارًا أو إبطال جهاز مستقلًا، فذلك نطاق تفويض إضافي غير منفذ. لا تثبت نتائج emulator وحدها جاهزية قاعدة الإنتاج.

**درجة الثقة:** عالية في التراجعات المحلية المحددة التي أعيد إنتاجها ثم اختُبرت؛ جيدة في الرحلات المعزولة على المحركات الثلاثة؛ غير كافية للحكم على صلاحيات production Firebase أو موثوقية الخدمات الحية أو التجربة على جهاز iOS فعلي. لا يوجد ادعاء بأن المشروع خالٍ من جميع الأخطاء.

## 2. Bugs Found

الشدات تصف الأثر، ولا تفترض أن كل مسار دفاعي قابل للاستغلال من الواجهة المعتادة. عبارة «الإصلاح» تعني التغيير المدمج والمتحقق منه محليًا. القيود التشغيلية التي لم يمكن اختبارها منفصلة في قسم Remaining Risks.

### الحالة والمزامنة والتواريخ

| ID / Severity | المكان والسبب الحقيقي | سيناريو الظهور | الإصلاح / دليل التحقق |
|---|---|---|---|
| STATE-01 / High | `pushReset`: مسح pending كاملًا بعد await لنسخة أقدم. | يعدّل المستخدم حقلًا أثناء انتظار حفظ reset؛ يُحذف تعديله من الطابور دون رفعه. | تأكيد snapshot المطابق فقط، والإبقاء على القيم الأحدث. `state-regressions.cjs`: تغيير أثناء reset معلّق. |
| STATE-02 / High | `epochPush` يمنع الطلب الثاني، وانتهاء الأول يمحو `resetPend` الأحدث. | عمليتا restore/reset متداخلتان. | ربط الإقرار بالـ epoch المرسل ثم إرسال reset الأحدث. اختبار عمليتين مع تأخير الإقرار. |
| STATE-03 / High | `flushNow` و`fbAdapter`: إنشاء check-then-set، وعدم فرض epoch عند تثبيت كتابة معلقة. | جهازان ينشئان namespace؛ أو تصل كتابة offline قديمة بعد reset أحدث فتُعيد البيانات المحذوفة. | transaction عند جذر المستخدم تقارن epoch وتدمج فقط epoch الموافق، مع `applyLocally:false`. 9/9 اختبارات adapter الفعلي وSDK المثبت على emulator، منها كتابة قديمة مؤجلة وإنشاء متوازٍ. |
| STATE-04 / Medium | `isISO`: قبول تطبيع `Date.parse` لتاريخ مستحيل. | `2026-02-30` ضمن backup أو sync. | مقارنة calendar round-trip دقيقة. اختبارات الشهر والسنة الكبيسة. |
| STATE-05 / High | `cleanMark`: اعتبار كل رقم finite timestamp صالحًا. | `studied: 1e308` ينتج Invalid Date ثم RangeError أثناء العرض. | فحص صلاحية Date وحدوده قبل التحويل والحفظ. حالة إقلاع Chromium ببيانات مشوهة. |
| STATE-06 / High | `clipsOf`: التحقق من المصفوفة دون عناصرها. | `c:[null]` في المقاطع القديمة. | تطبيع tuples الصالحة وإرجاع غياب آمن عند عدم وجود مقاطع سليمة، دون حذف feature. `state-browser.cjs`. |
| STATE-07 / High | `extraAll` / `syncBlocks`: افتراض topic نصًا وslots أرقامًا صالحة. | محاضرة مخصصة بـ topic كائن أو حدود عددية هائلة. | التحقق من نوع النص والهوية والتاريخ والمدى الصحيح للفترات. فحوص إقلاع/عرض ببيانات malformed. |
| STATE-08 / High | قاموس `DAY_IDX` يرث مفاتيح prototype. | custom lecture بتاريخ `__proto__` يمر بالفلتر ثم يكسر destructuring. | own-property/null-prototype والتحقق من التاريخ. اختبار المفتاح الموروث. |
| STATE-09 / Medium | فتح IndexedDB لكل عملية دون إغلاق. | جلسات طويلة وقراءات/كتابات متكررة. | إغلاق الاتصالات في جميع مسارات transaction. اختبار عدد opens/closes. |
| STATE-10 / High | `idbAI` بلا معالجة `onabort` أو خطأ callback متزامن. | quota/abort يترك Promise معلقة وواجهة loading لا تنتهي. | رفض واضح وتنظيف الاتصال على complete/error/abort/callback failure. اختبار bounded abort. |
| STATE-11 / Medium | حساب اليوم الدراسي بطرح أربع ساعات elapsed. | جهاز في منطقة DST يعامل 04:00 يوم الانتقال كتاريخ سابق. | حساب calendar محلي عند 04:00. اختبارات America/New_York وAsia/Riyadh. |
| STATE-12 / High | تنظيف wipe المؤجل لا يميّز البيانات المولّدة بعد المسح، وwipe العام لا يبطل جيل ANKI القديم. | إعادة توليد خلال نافذة 30 ثانية أو مسحان متتابعان؛ بيانات جديدة تُحذف/قديمة تعود. | تنظيف مرتبط بعملية المسح وتوقيتها، وإبطال الأجيال السابقة مع الحفاظ على undo. `state-wipe.cjs`. |
| STATE-13 / Medium | نجاح واجهة المصدر/الطابور رغم فشل persistence في بعض catch-to-null. | localStorage/IndexedDB ممتلئة أو read-only أثناء تقسيم ملف محلي. | رفض `aiPut` للكتابة الفاشلة، وإظهار خطأ تخزين وتنبيه `spSave` إلى احتمال فقد الاستكمال عند الإغلاق. storage denial/quota/permission: `state-errors.cjs` 8/8، مع بقاء القراءة الاختيارية قابلة للتعافي. |
| STATE-14 / High | full-reset replay يعيد snapshot محليًا متغيرًا أو يسمح بنفس epoch بعد وصول تعديل لاحق. | ضياع إقرار الشبكة ثم retry يمحو تعديلات جهاز آخر بعد reset الأول. | snapshot أول إرسال immutable، ورفض reset أقدم أو مطابق موجود بدل استبداله؛ SDK emulator يتحقق من `committed:false` وبقاء التعديل اللاحق. |
| STATE-15 / High | تطبيع custom lectures يسقط tombstone مختصرًا لأنه بلا date، ويتسامح مع IDs مكررة. | حذف حقيقي من الزر ثم stale merge يعيد المحاضرة، أو بيانات مزدوجة تنتج مهام/نقاط مكررة. | حفظ tombstones المختصرة، توحيد duplicate IDs واختيار النسخة الأحدث deterministic؛ اختبار الزر الحقيقي ثم merge داخل 101/101 fixtures. |
| STATE-16 / Medium | moved slots وحقول ledger/nested numbers تفحص finite فقط أو بلا bounds. | slot هائل يجمّد grid؛ تاريخ مستحيل أو مبلغ غير صالح يفسد الميزانية/الجدول. | slots صحيحة 0–14 مع توافق صيغ النقل القديمة، وفحص مجال كل حقل وتاريخه قبل الاستهلاك. 101/101 تشمل legacy numeric strings والفترات الكسرية الصالحة. |
| STATE-17 / Medium | stale-job recovery يعتمد على طرح heartbeat دون فحص ساعة مستقبلية. | heartbeat في سنة2500 يبقي ANKI أو split والعامل «حيًا» إلى الأبد. | اعتبار clock بعيد مستقبلًا stale مع سماح انحراف دقيقتين؛ إعادة الاستكمال وتفسير مرئي دون حذف هوية الطلب. clock 7/7 وbrowser 4/4. |
| STATE-18 / Medium | حفظ credentials/config أو إيقاف sync يبتلع فشل localStorage ثم يعيد التحميل. | privacy/quota mode يظهر نجاحًا رغم عدم حفظ المفتاح أو يعيد اتصالًا حاول المستخدم تعطيله. | تحذير واضح، إبقاء setup مفتوحًا وعدم reload عند فشل الكتابة/الإزالة. state-errors8/8 بما فيها3 حالات إضافية. |

### AI وANKI وملفات المحاضرات

| ID / Severity | المكان والسبب الحقيقي | سيناريو الظهور | الإصلاح / دليل التحقق |
|---|---|---|---|
| AI-01 / High | العامل يلتقط `akq.st=q` فقط، دون reclaim/heartbeat متين لطلبات `run`. | إغلاق العملية أو انتهاء وقتها وسط المهمة؛ الطلب يبقى عالقًا في الجولة التالية. | lease قابلة للاسترداد، heartbeat، وربط النشر بهوية الطلب الحالي. `ai-regressions.js` و`integration-regressions.cjs`. |
| AI-02 + APKG-02 / High correctness | فحص وجود أربعة خيارات دون تميّز نصها المرئي. | الإجابة الصحيحة وخيار خاطئ يحملان النص نفسه بعد decode/whitespace normalization. | رفض التكرار في JS/Python وإرسال إصلاح واضح. اختبار خيارات entities متكافئة. |
| AI-03 / Medium | `focus` يبقى موزعًا حسب الأوزان القديمة؛ add/cut/harder تعتمد على prompt وحده. | طلب focus لهدف منخفض الوزن لا يضيف 2–3 أسئلة، أو add يُسقط أفكارًا سابقة/cut ينتج أقل من الطلب. | تخصيص الزيادة للهدف، والتحقق من key IDs والأعداد وأنواع التحويل التي يمكن إثباتها بنيويًا. `ai-concurrency.cjs`. لا يثبت الاختبار صعوبة السؤال طبيًا. |
| AI-04 / Medium | `akFacts` يفترض nested arrays/objects صحيحة. | `slides` نص أو عنصر weak فارغ من رد fallback. | حراسة الأنواع والتطبيع عند حد القراءة. اختبارات malformed slides/weak. |
| AI-05 / Medium | `akDeckOK` يقبل cache شكليًا فقط ويثق بـ QA مخزنة. | بطاقات null أو count/P ناقص أو objective weight غير صالح تكسر العرض/redo. | التحقق من الحقول المستهلكة والأرقام المحدودة، وإعادة QA. `ai-regressions.js` و`ai-concurrency.cjs`. |
| AI-06 / Medium | `directRef` يستدعي `decodeURIComponent` دون احتواء الخطأ. | رابط يحوي `%` أو `%ZZ` أو UTF-8 مبتورًا. | رفض المرجع غير الصالح دون URIError. ثلاث حالات URL regression. |
| AI-07 / Medium | تحميل fallback يفقد AbortSignal أو يحد الحجم بعد تخصيص الملف كاملًا؛ PDF cleanup في النجاح فقط. | body متوقف، ملف كبير، أو إلغاء أثناء القراءة. | نقل signal، deadline يشمل body، قراءة streamed محدودة، وتنظيف PDF في finally. `ai-boundaries.cjs` وفحوص loader. |
| AI-08 / Medium | انتظار retries بـ sleep غير قابل للإلغاء. | 429/5xx ثم ضغط «وقّف» أثناء انتظار 90 ثانية. | delay قابل للإلغاء مع إزالة listener/timer عند التسوية. اختبار الإلغاء خلال حد زمني قصير. |
| AI-09 / Medium | listeners/reader locks تتراكم في النقل والانتظار وpolling. | طلبات ناجحة متكررة، abort مسبق أو إعادة polling. | finally للتنظيف وفحص pre-abort قبل fetch. اختبار عدم إرسال الطلب الملغى وعدم بقاء listeners. |
| AI-TABS / High reliability | `AKRUN` خاص بالتبويب، ونتائج متأخرة قد تكتب فوق cache أحدث. | تبويبان يولّدان المحاضرة نفسها؛ كلفة مكررة وآخر نتيجة لا تكون الأحدث. | Web Lock عندما يتوفر، وكتابة deck ذرية تتحقق من timestamps وإبطال stale completion. `ai-tabs.cjs`: متصفّح حقيقي بتبويبين. قفل موزع ذري بين أجهزة Firebase المستقلة **ليس مثبتًا**. |
| AI-10 / Medium | JSON `null` وSSE/tool-call entries غير كائنية تؤدي إلى TypeError مصنف خطأً CORS. | رد ناقص يوقف شغل الخلفية مؤقتًا بدل اعتباره ردًا غير صالح. | حراسة الأنواع وتصنيف invalid response بدقة؛ `ai-boundaries.cjs` 9/9. |
| AI-11 / Medium | cleanup ينتظر `reader.cancel()` بلا حد بعد مسح deadline. | underlying stream يعيد cancel Promise لا تنتهي؛ الفشل نفسه يبقى loading إلى الأبد. | بدء cancel مع rejection handling دون حجب تسوية الطلب، ثم تحرير lock. اختبار WHATWG ReadableStream فعلي معلّق الإلغاء. |
| AI-12 / Medium | PDF document/loading task لا تُدمّر في كل failure/cancellation. | فشل استخراج صفحة أو إلغاء أثناء load يترك worker/listeners وموارد document. | finally للتدمير وربط AbortSignal وإزالة listener؛ اختبارات pre-abort/load-cancel/page-failure/success cleanup. `isEvalSupported:false` كان موجودًا سابقًا ولا يُحسب إصلاحًا جديدًا. |
| AI-13 / Medium | `loadScript` بلا deadline أو deduplication أو cleanup/retry أو integrity. | طلبان يحملان نفس المكتبة مرتين؛ CDN متوقف يبقي Promise معلقة. | deadline25s وshared Promise وحذف tag الفاشل وإعادة المحاولة وSHA384 لـ7 URLs classic معروفة. loader6/6، وتغيير بايتات JSZip يرفضه SRI في المتصفح. |
| AI-14 / Medium | dynamic import لـPDF4 ينتظر بلا deadline قبل fallback. | توقف CDN قبل headers يمنع classic fallback من العمل. | race محدود25s مع clear timer واحتواء التسوية المتأخرة. الاختبار السابع الحقيقي للمكتبات يعطّل modern response ويتطلب extraction عبر classic worker؛ ضمن12/12 في Chromium وWebKit. |
| AI-15 / High reliability | PowerPoint مضغوط صغير يسمح باستخراج XML غير محدود، والثقة بحجم ZIP المعلن وحده قابلة للتجاوز. | شرائح مضغوطة بحجم هائل بعد الفك أو header كاذب قد يستهلك الذاكرة أو يجمّد الصفحة. | حد2MB XML للشريحة و20MB للمحاضرة و2000 شريحة؛ عد فعلي أثناء stream مع pause عند تجاوز الحد/الإلغاء وتنظيف listener.5 حالات upload إضافية ضمن12/12 لكل من Chromium وWebKit؛ لم يُفك ملف GB فعلي. |
| APKG-01 / High security | حقول البطاقات تدخل Anki WebView كـ HTML موثوق؛ source لم يكن escaped. | source يبدأ بـ Slide N ثم event handler/script. | source escaping وفحصه في العميل؛ allowlist `<b>/<br>` دون attributes في الباني، مع escape للتاغات الأخرى. فحص SQLite واستيراد Anki فعلي. |
| APKG-03 / Medium | direct builder يفترض أنواع JSON/cap/objectives، ويسمح بأرقام غير finite. | null answer، options خاطئة، objective غير hashable، JSON عميق أو NaN. | validation bounded ورسائل خطأ واضحة بدل traceback. 10,000 شكل malformed، واختبارات CLI وfailed-then-valid queue. |
| APKG-04 / Medium | `cards[:400]` يقص الطلب ويعلن نجاحه. | طلب أكثر من 400 بطاقة عند حد JSON. | رفض صريح دون بناء مجموعة ناقصة. اختبار 401 بطاقة. الواجهة المعتادة أقل من هذا الحد؛ هذا إصلاح حد الخدمة. |
| APKG-05 / Medium hardening | callable job ID ومسارات media ونسخ destination symlink غير محمية بالكامل. | استعمال الباني مباشرة بملف media خارج المجلد أو artifact link. | تحقق ID في الدالة نفسها، media داخل مجلدها، no-follow/رفض symlink directories وatomic replace. اختبارات ملفات مؤقتة؛ ليست دعوى exploit من UI المعتاد الذي كان يتجاهل job media أصلًا. |
| APKG-06 / Medium | استبدال archive/status في المكان دون atomicity. | فشل ZIP أو write يمحو ملفًا سابقًا أو يترك JSON جزئيًا. | ملفات مرحلية بنفس المجلد ثم replace بعد الإكمال؛ لا acknowledgment قبل نجاح status. حقن أعطال يثبت بقاء القديم والمدخل القابل للإعادة. |
| APKG-07 / Medium | مجلد SQLite مؤقت خارج مجلد job لا يُزال. | كل بناء يترك collection مؤقتة حتى حذف بيئة التنفيذ. | finally يغلق connection ويحذف DB ومؤقت ZIP في النجاح والفشل. اختبارات اعتراض mkdtemp. |
| APKG-08 / Low | حد review يُحسب بالحروف بدل UTF-8 bytes. | عربي/emoji يتجاوزان الحد المعلن بالبايتات. | قياس بايتات UTF-8 وإهمال review اختياري غير صالح/كبير دون فقد ملف صالح. اختبار payload متعدد البايتات. |
| APKG-09 + JOB-01 / High reliability | وقت workflow ست دقائق، وحلقة غير محدودة مع 120 ثانية لكل بناء. | طابور بطيء ينتهي قبل خطوة الحفظ، ثم يُعاد من بدايته مرارًا. | نافذة دفعة 230 ثانية تحجز زمن البناء التالي، تحفظ المنجز وتترك الباقي ثم redispatch. اختبار monotonic مصطنع وGit save race؛ لا dispatch إنتاجيًا ضمن هذه التجارب. |
| APKG-10 / Low | test reads تترك handles مفتوحة. | تشغيل ResourceWarning صارم. | `Path.read_text` وإغلاق الموارد؛ suite مع ResourceWarning كخطأ. |

### العامل وCI/CD

| ID / Severity | المكان والسبب الحقيقي | سيناريو الظهور | الإصلاح / دليل التحقق |
|---|---|---|---|
| RUN-01 / High | Chromium بـ `--disable-web-security` وinit secrets لكل document/frame. | off-origin navigation أو iframe يحصل على credentials. | إبقاء browser security، bridge محلي nonce/Host/Origin ومحدد endpoints، وحقن top-frame المحلي فقط ومنع مغادرة origin. Chromium حقيقي مع SSE وهمي. |
| RUN-02 / High | cleanup خطي لا يعمل عند فشل launch/goto/evaluate. | تبقى browser/profile/server تحمل secrets بعد خطأ. | finally مستقل لكل مورد وإزالة profile/listeners ولو فشل close. اختبارات launch/navigation/cleanup failures. |
| RUN-03 / Medium | وقت الحلقة لا يحد evaluate معلقة. | صفحة متجمدة تبقي العملية حتى Actions timeout. | deadlines للقراءة وcache، وحدود lifetime finite. اختبار never-resolving evaluate. |
| RUN-04 / High | restore/snapshot يسمحان بمفاتيح وحقول cache غير منقّاة. | حفظ نص bookmark خاص أو credentials في Actions cache. | whitelist رقمية/معرّفات فقط، دون نص المحاضرة أو hk/private args؛ ملف 0600 وatomic rename وnamespace v2. fixture cache مسموم. النسخ القديمة خارج checkout تحتاج متابعة مشغّل الخدمة. |
| RUN-05 / Medium | قيم mask الخام تدخل workflow command، وتُطبع في التشغيل المحلي. | secret يحوي `%` أو CR/LF؛ log لا يعالج URI/JSON variants. | escaping لـ workflow commands وredaction للمتغيرات المرمّزة؛ masks فقط داخل Actions. اختبارات newline/encoded secrets دون طباعة قيم حقيقية. |
| RUN-06 / Medium | config مشوه يخرج 0 أو timezone غير صالح يكسر الإقلاع. | null/arrays/قيم مفقودة أو Infinity. | validation ورسائل ثابتة غير حساسة؛ malformed configured config يفشل، والغياب وحده no-op مقصود. اختبارات متعددة للأنواع والمنطقة. |
| RUN-07 / Medium | غياب sync أو crash صفحة قد ينتهي بنجاح شكلي. | العامل ينتظر دون بيانات حتى انتهاء الوقت. | فشل واضح عند crash أو تجاوز انتظار sync، مع استمرار cleanup. اختبار timeout معزول. |
| JOB-02 / Medium | shell word splitting لأسماء ملفات fetched من فرع المهام. | اسم خبيث/مسافات/symlink أو وصول مهمة أثناء force-with-lease retry. | save script NUL-safe ويتحقق من IDs/modes ويحتفظ بالأعمال المتأخرة. temporary bare Git remote وpre-push race يثبتان ذلك. |
| DEV-02 / Medium test tooling | Firebase CLI يضيف dependency tree ذا advisories غير لازمة لاختبار JAR؛ bootstrap pip قديم غير مقفل. | تشغيل CI يضيف مخاطر لتبعيات أدوات التدقيق دون حاجة إنتاجية. | استبدال CLI بـPython harness يتحقق من SHA256/size لـJAR4.11.2 ويملك lifecycle/deadlines؛ pip26.2.2 و13 حزمة Anki مثبتة. OSV بلا advisories معادة لـpip والنسخ المختبرة؛ emulator27 وPython40 نجحا. |
| DEV-01 / Medium | لا lockfiles، installs غير مقفلة، Actions tags متحركة، ولا validation CI. | تغيير transitive dependency أو وصول regression دون حارس. | lockfiles وnpm ci، إبقاء Playwright الحالي، pin Actions SHAs، CI read-only. npm audit/actionlint واختبارات العامل. تفعيل branch protection الفعلي يظل تحقق مشغّل. |

### الواجهة والتوافق

| ID / Severity | المكان والسبب الحقيقي | سيناريو الظهور | الإصلاح / دليل التحقق |
|---|---|---|---|
| FE-01 / Medium | `setPage` يستبدل history وempty hash يُهمل. | main→ideas→settings ثم Back/Forward أو حذف hash. | history-aware routing وتحديث من popstate/hashchange دون إضافة entries في traversal. رحلة browser history/deep-link/refresh. |
| FE-02 / Medium | dialog بلا اسم أو نقل focus أو Tab containment/restoration. | فتح نافذة يبقي لوحة المفاتيح خلف overlay. | اسم من العنوان، initial focus، trap، وإرجاع trigger عند الإغلاق النهائي. keyboard وaxe aria-dialog-name. |
| FE-03 / Medium | parseInt يتجاهل صلاحية number input. | `1.9` أو `1e3` يسجلان بطاقة واحدة أو يتجاوزان حدًا بطريقة صامتة. | Number/integer/validity/range قبل mutation في المسارين. قيم غير صالحة لا تغير الحالة، و12 تُحفظ. |
| FE-04 / Medium | flex/grid intrinsic minimums تفيض في Firefox 320px. | scrollWidth 327 وعمود 288px يقص آخر الأيام. | min-width:0 وminmax(0,1fr) للعمود والأيام. قياس Firefox 327→320 ثم matrix كامل. |
| FE-05 / Medium | role=tablist مع أزرار aria-pressed لا تشكّل tabs. | axe aria-required-children في مسيرتي. | role=group باسم مناسب يحافظ على وظيفة المرشحات. axe. |
| FE-06 / Medium | opacity على محتوى صغير يهبط بالتباين. | نص أبيض/رمادي فعلي 2.28:1 بدل 4.5:1. | إزالة تعتيم النص؛ اختبار light/dark. |
| FE-07 / Medium | الأحمر وخفض opacity لوسوم الشهر لا يبلغان التباين. | النص الصغير 3.72:1. | لون مناسب مع opacity كاملة للوسوم. axe للشهر في الوضعين. |
| FE-08 / Medium | OS reduced motion يعطل JS فقط دون transitions CSS عامة. | إعداد الجهاز reduce مع استمرار تحريك الأزرار. | suppression عام للتأثيرات بما فيها pseudo-elements مع بقاء الوظيفة. قياس computed durations تحت reduced-motion. |
| FE-09 / Medium | Blob object URLs لا تملك cleanup موحدًا عند إغلاق/استبدال أو تخطي الصوت. | تكرار فتح التسجيلات وMP3 يبقي بيانات مرتبطة بعناوين لا تُحرر. | ownership صريح وإلغاء URL عند الإغلاق والاستبدال والتخطي، مع إبقاء URL النشط صالحًا. `frontend_media.cjs` ضمن 20/20. |
| FE-10 / Medium | `getUserMedia` أو تحويل MP3 يعود بعد تغيير النافذة. | الموافقة المتأخرة تترك microphone tracks حية، أو تحويل مكتمل يعيد نافذة أغلقها المستخدم. | generation/owner checks؛ إيقاف tracks المتأخرة وعدم إعادة النافذة. 20/20 بfixtures MediaRecorder/getUserMedia؛ دون استخدام ميكروفون فعلي. |
| FE-11 / High reliability | حفظ التسجيل ينتظر IndexedDB ثم يغلق أي sheet مفتوح، وقد ينشر بعد wipe/reset. | المستخدم يفتح نافذة أخرى أو يمسح البيانات أثناء الحفظ. | ربط إغلاق النافذة بمالك العملية، وفحص إبطال wipe/reset قبل النشر والتنظيف. الإغلاق العادي لا يلغي save مصرحًا به؛ اختبارات save/close/wipe/reset ضمن 20/20. |
| FE-12 / Medium | نجاح منح microphone لا يضمن دعم MIME أو إنشاء/بدء MediaRecorder. | `isTypeSupported` أو constructor أو start يرمي بعد منح stream، فتظل tracks دون تحرير. | try/catch يغطي مراحل الإنشاء والبدء، يوقف recorder/tracks ويعرض text fallback قابلًا للحفظ؛20/20 تشمل حالتين جديدتين وغياب console/page errors. |

كل حالات الفشل المحلية المؤكدة المذكورة أعلاه أُصلحت وأُعيدت اختبارات regression لها. هذا لا يثبت خلو التطبيق من أعطال غير مكتشفة؛ الحدود التشغيلية والمعمارية المتبقية مفصولة أدناه.

## 3. Security Findings

| ID / Severity | السبب والسيناريو | المعالجة والتحقق |
|---|---|---|
| SEC-01 / High | IDs/ratings/مفاتيح knots/rewards وfrozen-fine labels غير موثوقة تدخل attributes/HTML. backup أو sync خبيث ينفّذ marker في origin التي تخزن API credentials. | validation للقيم والـ enums وescaping عند العرض. `security-repros.js --assert-secure` يعيد ثمانية probes خاملة دون قراءة credentials أو exfiltration. |
| SEC-02 / High | nested sync paths تتبع `__proto__` داخل `claudeAdapter.nest`، وpending يسمح بsegments خطرة. | deny unsafe segments، own-property/null-prototype وقيد حقول pending. اختبار تلوث prototype يعيد الخاصية الموروثة إلى غيابها. |
| SEC-03 / High | رابط `#sync=...` يكتب config/key الجديدين فورًا ثم يدمج بيانات جهاز موجود. | مرحلة تأكيد واضحة عند تغيير الوجهة على جهاز لديه إعداد/بيانات، مع الحفاظ على onboarding الجهاز الفارغ. اختبار لا يغير config قبل الموافقة. |
| INT-01 / High functionality | backslashes داخل template تضيع في Worker المولّد؛ `/url` ينتج syntax error. | إصلاح التمثيل المولّد واختبار النص الناتج نفسه، لا parsing الصفحة الحاوية فقط. `validate.cjs` و`security-worker.test.cjs`. |
| SEC-04 / Medium | proxy بلا حدود متينة للطرق/body/Origin/وجهة redirect، مع أهداف محلية أو خاصة. | رفض الأهداف غير العامة وcredentials وredirects غير الآمنة، حدود fetch/size والطرق. اختبارات Worker محلية. Origin/CORS وحدهما **ليسَا نظام authorization** ضد عميل يستطيع تزويرهما. |
| INT-02 / Medium | image cache في Apps Script مفهرس بالملف فقط، وtracking عام لا يميّز الحساب/المنطقة. | namespace بمنطقة API وSHA-256 للمفتاح دون تخزين قيمته، وعدم إعادة IDs حساب سابق. اختبار generated bridge؛ لم تُستخدم حسابات Moonshot حية. |
| SEC-05 / Medium | fallback GET يضع Kimi key داخل `?q=`. | حظر GET للطلبات الحاملة للمفتاح والاعتماد على POST المتوافق. `security-gas-client.test.cjs` وbridge tests. |
| SEC-06 / High trust boundary | إعداد Firebase مستورد أو محفوظ قد يحمل endpoint خارجيًا غير موثوق يصل إلى SDK الموثوق وتحميله الديناميكي. | حراسة config قبل SDK/backend request، قبول namespaces Firebase المعروفة وHTTPS فقط ورفض credentials/host/path غير الصالح. config4/4 تشمل20 config hostile في مساري import/startup وصيغ legacy/regional؛ لا اتصالات خارجية لهذه المدخلات. |
| SEC-07 / Medium compatibility | CDN-only CSP تمنع JSONP الذي يستخدمه Firebase عند تعذر WebSocket. | `strict-dynamic` ينقل الثقة من hash script إلى loader وdescendants الشرعية دون `unsafe-inline`؛ emulator2/2 يجبر long-poll فعليًا ويثبت فشل policy control ونجاح production بلا WebSocket/console errors. |
| DEP-01 / High component advisory | PDF.js classic fallback3.11.174 مرتبط بـ`GHSA-wgrm-67xf-hhpq` / `CVE-2024-4367` عند معالجة PDF مصمم لاستغلال evaluation. | أبقِي fallback للتوافق؛ استدعاء `getDocument` الوحيد كان أصلًا يستخدم `isEvalSupported:false`، وCSP الحالية لا تسمح `unsafe-eval`، فيُحجمان المسار المعروف. لا يُدّعى أن package نفسها patched؛ يلزم الانتقال مستقبلًا إلى fallback متوافق ومصحح. |

المعالجة المتعلقة بـ Anki WebView وcredentials العامل مفصلة في APKG-01 وRUN-01/04/05. كل تجارب XSS استعملت markers محلية خاملة؛ لم تُسحب بيانات حساسة.

**Authentication وAuthorization:** لا يوجد signup/login/logout/password reset/email verification/refresh-token/roles في التطبيق. لم يتم الادعاء باختبار تلك الوظائف. المفتاح السري للمسار هو صلاحية الوصول الحالية؛ امتلاكه يتيح الوصول حتى من عميل بلا auth.uid. لا تمنح القواعد المقترحة حسابًا مسجلًا أو admin claim حق قراءة collection كاملة، لكنها لا تحول capability إلى حساب مستخدم. اختبارات emulator تُظهر هذا الفرق عمدًا.

**Firebase:** سياسة deny-parent والـ per-key leaves موجودة ومختبرة بـ16 REST case في emulator حقيقي، بما فيها enumeration/key bounds/audio/lock/multi-path rollback/tombstones. واختُبر adapter الإنتاجي نفسه بـ9 حالات وSDK10.12.2 وثلاثة عملاء Chromium على emulator جديد؛ epoch CAS يمنع كتابة قديمة أو إعادة reset بعد تعديل أحدث. أضيف اختبارا long-poll تحت CSP الحقيقية؛ harness المباشر يتحقق منJAR ويوقف العمليات التي يملكها، دون تثبيت Firebase CLI. syntax يسمح بمفاتيح ASCII من20 إلى768 حرفًا للمحافظة على الصيغ القديمة، لكن Firebase يحد **المسار الكامل** بـ768 bytes؛ مفتاح200 يعمل ومفتاح768 تحت `users/` يُرفض. قبول الصيغة ليس ضمان قابلية كل طول على كل child path. لا توجد migrations أو schemas relational أو indexes SQL لبيانات التطبيق يمكن ادعاء اختبارها. لا إثبات على أن production database تستعمل هذه السياسة؛ لم تُختبر بيانات production أو عزل tenant بحسابين حقيقيين.

**Secrets:** الفاحص الحالي يعرض موضع ونوع candidate فقط، دون قيم. لم يجد المسح المحلي candidates حقيقية في الشجرة المفحوصة؛ لم يُطبع أي secret. عدم العثور على candidate ليس إثباتًا لغياب كل سر، وليس مراجعة كاملة لتاريخ Git أو clones أو Actions caches قديمة. Firebase web config العامة لا تُصنّف تلقائيًا private secret.

**Dependencies:** نجح `npm audit` للمشروعين دون findings وقت الفحص، لكنه لا يغطي وحده مكتبات CDN. استعلام OSV عام للنسخ المحددة لم يجد direct advisories لـPDF4.10.38 وJSZip3.10.1 وlamejs1.2.1 وFirebase10.12.2 وundici6.29.1 وplaywright-core1.56.1 وAnki25.9.5، ووجد advisory العالي المذكور لـPDF3.11.174. التخفيف الموجود يخص exploit path المعروف ولا يساوي إزالة advisory أو إثبات غياب كل ثغرة. اختُبر أيضًا pip26.2.2 و13 حزمة Python مقفلة بإصداراتها الحالية دون advisories معادة؛ لا يستبدل هذا مراجعة مستمرة. أُزيل Firebase CLI من bootstrap بدل إضافة شجرة تبعياته للاختبار. لم تُنفّذ major upgrade عشوائية لإخفاء advisory fallback.

**HTTP policies:** baseline العام كان بلا CSP أو referrer policy موثقة. النسخة المحلية تُرسل CSP عبر meta مع SHA256 للـinline script، دون `unsafe-inline` أو `unsafe-eval`، ومع `strict-dynamic` للـFirebase fallback، وتمنع object/base/form destinations غير المقصودة؛ `no-referrer` مضاف. hash checker وCI يمنعان بصمة قديمة، واختبارات المكتبات الفعلية تعمل مع السياسة مفعّلة. SHA384 SRI يغطي classic URLs المعروفة؛ modern PDF module محمّل بـmodule tag مع SHA384 SRI متحقق؛ worker URLs الخارجية تبقى بإصدار ثابت دون browser SRI. سياسات HTTP-only مثل `frame-ancestors` لا يمكن فرضها بوسم meta؛ تحتاج ضبط الاستضافة/edge. صلاحيات GitHub token وإعدادات حماية الفروع ليست مضمونة من ملفات المشروع وحدها.

## 4. Performance Findings

- أُصلحت موارد تتراكم في AI fetch/gate/polling: timers وabort listeners وreader locks. هذا يحسن موثوقية الجلسات الطويلة ويمنع بقاء طلبات بعد الإلغاء؛ يثبت ذلك اختبار عدم بقاء listeners، وليس benchmark ذاكرة شاملًا لجميع الأجهزة.
- IndexedDB يغلق الاتصالات ويعالج abort بدل التعليق؛ باني APKG ينظف مجلدات SQLite والمؤقتات في النجاح والفشل. العامل يغلق المتصفح والخادم وtransport ويزيل profile مهما كان مسار الخروج.
- قراءة الملفات أصبحت محدودة خلال streaming مع total deadline؛ يمنع ذلك تخصيص body غير محدود قبل اكتشاف الحجم أو بقاء التحميل إلى الأبد.
- طابور ANKI يُعالج على دفعات تترك زمنًا للحفظ؛ هذا تحسين للتقدم تحت backlog والفشل البطيء، لا ادعاء بقياس throughput لخدمة production.
- الواجهة تبقى ملفًا كبيرًا يقارب megabyte مع assets صوتية وCDN loaders. لم تُنفذ إعادة كتابة أو ترقية major اعتباطية. يبقى قياس Core Web Vitals وCPU/ذاكرة جهاز بطيء وشبكة إنتاجية فعلية ضمن المتابعة المطلوبة.
- اختبارات الأحجام تمنع document overflow غير المقصود عبر 320–1920px وlandscape، لكنها لا تُحوّل تلقائيًا إلى نتيجة Lighthouse أو ضمان سرعة ثابتة.
- قياس فعلي محلي بـChromium وCPU4× وعشر عينات لكل طرف: cold load الوسيط960.85→991.95ms(+3.2%)، full render19.40→20.25ms(+4.4%)، فتح المحاضرة55.55→56.90ms(+2.4%)، وحفظ bookmark المحلي72.90→73.35ms(+0.6%). النطاقات متداخلة ولا تثبت تحسن سرعة أو تراجعًا ماديًا؛ القياس يخص SHA256 المصدر المجمد المذكور أعلى الوثيقة. التفاصيل والبايتات وSHA256 وكل العينات في [PERFORMANCE.md](PERFORMANCE.md) و[performance-results.json](performance-results.json).
- transaction Firebase عند جذر المستخدم تحقق عزل epoch بصورة ذرية مقابل نقل snapshot أكبر من field update؛ لم يُقَس throughput أو تكلفة النقل لحساب ضخم على خدمة حية. لا يُقدّم هذا التغيير كتحسين أداء.

## 5. Tests

### ما كان موجودًا

اختبارات Python لـ job/APKG واتفاق نسخة البرومبت؛ واختبارات JavaScript للعدد والتغطية والتوزيع وتقسيم الصفحات؛ ورحلة Chromium مختصرة لواجهة ANKI. قراءة هذه الاختبارات سبقت إضافة التغطية الجديدة.

### التغطية المضافة والأدلة المنفذة لكل مجموعة

| المجموعة / الملفات | ما تختبره فعلًا | النتيجة / الحدود |
|---|---|---|
| Python `test_*.py` | malformed inputs، caps، duplicate options، HTML، paths/symlinks، atomic output/status، timeout/cleanup/batch، review byte limits؛ fuzz10,000 shapes داخل التغطية. | **40/40** مع Anki25.9.5/Python3.12.14، دون ResourceWarning. بيئة stdlib وحدها تتخطى2 تكامل اختياريين؛ CI يثبت المحرك ويستدعي `Collection` صراحة لمنع silent skips. |
| Anki backend فعلي | import/render وإعادة استيراد **الملف نفسه** للنموذجين16 و9 fields، counts/tags/objective/WeakSpot واستقرار IDs للمدخل نفسه. | مشمول ضمن40؛ لا يثبت حذف بطاقات قديمة من collection عند cut/rebuild. اختبار backend إضافي:3 بطاقات ثم ملف2 يبقي3 ملاحظات في collection. ليس Anki GUI/AnkiMobile/AnkiDroid. |
| Runner/Git `test_runner.mjs`, `test_anki_save.mjs` | عملية Chromium/SSE معزولة، nonce bridge، cache poisoning، masks، bad config، hung evaluate، failure cleanup، bare Git/pre-push race. | **14/14** على Node22؛ لا dispatch حي أو رفع cache إنتاجي. |
| Frontend `frontend.cjs` | عشر صفحات ×320/375/390/430/768/1024/1280/1440/1920px وlandscape844×390، history/deep links/refresh، ideas، gate، pause/resume، invalid counts، offline/storage، console/rejections. | **13/13 Chromium154،13/13 Firefox153،13/13 WebKit26.5**. fixture state/network معزولان. |
| Accessibility | axe4.11 WCAG2A/AA/2.1AA، كل الصفحات light/dark وdialog. | **21/21**؛ منع zoom استثناء منتج معلن؛ ليس اختبار screen reader فعليًا. |
| Media `frontend_media.cjs` | Blob URL ownership، late permissions، stream stop، conversion، async save/close/wipe/reset. | **20/20**، APIs الصوت mocked؛ لا hardware microphone أو encoding/latency على iPhone. |
| Firebase `security-firebase.test.cjs` | REST إلى emulator4.11.2/Java21، anonymous/auth fixtures، deny enumeration، key bounds/state/audio/lock/atomic rollback/tombstones. | **16/16**؛ سياسة checkout فقط، لا قاعدة production. |
| Epoch `state-epochs.cjs` | adapter الفعلي وSDK10.12.2 وثلاثة Chromium clients؛ initialization/concurrent edits، cold-cache null، old offline writes، old/same reset replay، recovery و`applyLocally:false`. | **9/9** على emulator حقيقي جديد؛ عميل قديم أو bearer writer مباشر قد يتجاوز بروتوكول CAS. |
| Firebase long-poll `state-longpoll.cjs` | تطبيق كامل مع hash-authorized script وSRI loader، SDK حقيقي، WebSocket معطل، cross-origin JSONP إلى emulator. | **2/2**؛ control policy يُمنع وstrict-dynamic يعمل بلا console errors؛ صلاحية local-network للfixture فقط. |
| Firebase config `security-firebase-config.cjs` | legacy/regional/derived/copied JS،20 hostile configs لكل startup path، endpoint filtering ومفاتيح20/128/200/768 syntax. | **4/4**؛200 مستخدم فعليًا في emulator،768 syntax لا يتجاوز total-path byte limit. |
| Queue `state-queue.cjs` | orchestration لدوال المزامنة الرئيسية الفعلية؛ abort، lost acknowledgment، newer epoch، واستبدال queue أثناء الطلب. | **4/4**؛ مكملة لاختبار adapter الحقيقي على emulator، دون بيانات حية. |
| AI `ai-regressions.js`, `ai-concurrency.cjs` | الردود malformed، cache validation، reclaim/heartbeat، follow-up counts/key preservation/objective focus، weak-card budget مستقل. | **14/14 و16/16**؛ لا إثبات لدقة الطب أو صعوبة صياغة السؤال. |
| AI `ai-boundaries.cjs`, `ai-loader.cjs`, `integration-regressions.cjs` | bounded streaming، cancel/reader cleanup، PDF lifetime، malformed JSON/SSE، script timeout/dedupe/SRI، عقود واجهة المهام. | **9/9،6/6،6/6** على المصدر المدمج؛ دون credentials أو طلبات مدفوعة. |
| Tabs `ai-tabs.cjs` | تبويبان بنفس origin يستخدمان `akStart` الحقيقي؛ Web Lock يمنع double generation ويُحرر عند cancel. | **3/3** Chromium؛ ليس distributed generation lock بين أجهزة مستقلة. |
| Actual libraries `ai-libraries.cjs` | PDF4 module/worker وPDF3 classic/worker، PPTX/JSZip، Firebase/lamejs، SRI corruption rejection، zero unexpected CSP/console errors، stalled module→fallback، والرفع الحقيقي و5 حالات decompression/limits/cancellation. | **12/12 Chromium و12/12 WebKit** من10 CDN artifacts متحققة SHA384. نسخة harness على Firefox تقع في interception/CORS للـblob module worker؛ لا تُحسب كتحقق نظيف له. |
| State regression/browser/wipe/errors | reset queues، malformed dates/clips/custom data، IDB close/abort، DST، wipe/undo/new generation، tab pending، quota/permission. | **7/7،7/7،8/8،8/8**؛ mock services وChromium للرحلات المطلوبة. |
| State fuzz `state-fuzz.cjs` |101 مجموعة بيانات متطرفة عبر كل PAGES والreaders؛ bounds مالية/تواريخ، compact tombstones، duplicates، slots، backward compatibility. | **101/101**؛ تشمل زر حذف محاضرة حقيقيًا ثم stale merge دون إعادتها. |
| Clocks `state-clock.cjs`, `state-clock-browser.cjs` | fake-clock job recovery وtwo-minute skew؛ ANKI watcher/split UI/runner health الحقيقي في المتصفح. | **7/7 و4/4**؛ لا أجهزة فعلية بساعات متعارضة أو storage eviction iOS. |
| Security repro/Worker/bridge/GAS client | inert XSS وprototype/sync destination، generated-code parsing، HTTP input/redirect/limits/cache identities وkey body-only. | **8/8،21/21،8/8،4/4**؛ mocks/VM/browser آمنة دون exfiltration أو credentials حقيقية. |
| Dependencies/static policy | clean installs، audits، جميع JS/Python syntax، generated scripts، correctness lint، CSP hash، shell وworkflow syntax. | نجحت محليًا؛ dependency audit0 وقت الفحص لا ضمان دائم لقاعدة CVE. |

لا تُجمع101 fixtures و10,000 fuzz shapes مع high-level tests في إجمالي مضلل. CI يحتوي هذه المجموعات والتثبيت الإلزامي لمحرك Anki؛ وجود workflow لا يثبت تشغيله على GitHub قبل رؤية نتيجته.

## 6. Commands Executed

هذه أوامر التحقق الرئيسية ونتائجها المحلية الفعلية. أوامر emulator تتطلب تشغيل الخدمة المعزولة أولًا كما في [توثيق Firebase](../infra/firebase/README.md). مسارات `/tmp` تخص بيئة التدقيق وليست dependency إنتاجية.

| الأمر | النتيجة |
|---|---|
| `npm ci --prefix tools/runner --ignore-scripts` و`npm ci --prefix tools/audit --ignore-scripts` | تثبيت نظيف من lockfiles؛ بلا dependency conflicts مؤثرة. |
| `npm audit --prefix tools/runner --audit-level=moderate` ونسخته لـ`tools/audit` | **0 findings** في الاثنين وقت الفحص. |
| `node tools/audit/validate.cjs` و`node tools/audit/csp.cjs` | parsing للتطبيق وWorker/Apps Script المولدين، correctness lint وبصمة CSP نجحت؛ لا يُسمى ذلك TypeScript typecheck. |
| `node --check` لكل `.js/.cjs/.mjs` و`python -m py_compile` لكل Python source | جميع المصادر نجحت؛ تشمل أدوات الاختبارات. |
| `bash -n .github/scripts/save-anki.sh` و`actionlint .github/workflows/*.yml` | نجحا؛ actionlint1.7.7 متحقق release checksum. |
| `python -m pip install -r tools/anki/requirements-test.txt` و`python -m pip check` | pip26.2.2 وAnki25.9.5 و12 تبعية Python أخرى مثبتة بإصدارات محددة في virtualenv معزول؛ no broken requirements. |
| `/tmp/anki-import-audit-venv/bin/python -W error::ResourceWarning -m unittest discover -s tools/anki -p 'test_*.py' -q` | **40/40**، بلا skipped؛ محرك Anki الحقيقي داخل المجموعة. |
| `node tools/anki/test_objectives.js` و`node tools/anki/test_browser.js` | اختبارات objective/cap/budget وتقسيم الصفحات ورحلة ANKI نجحت. |
| `node --test tools/runner/test_runner.mjs tools/runner/test_anki_save.mjs` | **14/14** على Node22. |
| `node tools/audit/ai-regressions.js`، `ai-concurrency.cjs`، `ai-boundaries.cjs`، `ai-loader.cjs`، `integration-regressions.cjs` | **14/14،16/16،9/9،6/6،6/6**. |
| `node tools/audit/ai-tabs.cjs` | **3/3**؛ متصفح وتبويبان حقيقيان. |
| `node tools/audit/state-regressions.cjs`، `state-browser.cjs`، `state-wipe.cjs`، `state-errors.cjs`، `state-fuzz.cjs` | **7/7،7/7،8/8،8/8،101/101**. |
| `node tools/audit/state-clock.cjs` و`node tools/audit/state-clock-browser.cjs` | **7/7 و4/4**. |
| `node tools/audit/state-queue.cjs` | **4/4** actual main synchronization orchestration. |
| `node tools/audit/frontend.cjs` و`AUDIT_BROWSER=firefox ...` و`AUDIT_BROWSER=webkit ...` | **13/13 لكل محرك**؛ binaries/system libraries ثُبتت في بيئة الاختبار. |
| `node tools/audit/frontend_accessibility.cjs` و`node tools/audit/frontend_media.cjs` | **21/21 و20/20**. |
| `python3 tools/audit/cache-cdn.py` ثم `node tools/audit/ai-libraries.cjs` ونسخة `AUDIT_BROWSER=webkit` | تحققت10 URLs عامة، ثم **12/12 لكل محرك** مع CSP الإنتاجية؛ لم تبدأ جلسة Firebase حية. |
| `python3 tools/audit/security-scan.py` و`node tools/audit/security-repros.js --assert-secure` | لا candidates فعلية في الشجرة؛ **8/8** markers خاملة دون تسريب قيم. |
| `node tools/audit/security-worker.test.cjs`، `security-bridge.test.cjs`، `security-gas-client.test.cjs` | **21/21،8/8،4/4**. |
| `GCLOUD_PROJECT=demo-uqu-audit FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9005 node tools/audit/security-firebase.test.cjs` ثم `state-epochs.cjs` | **16/16 و9/9** متتاليان على emulator حقيقي جديد؛ لا قراءة/كتابة production. |
| `node tools/audit/security-firebase-config.cjs` | **4/4**؛ malformed configuration لا يصل إلى SDK أو backend. |
| `python3 tools/audit/run-firebase.py` | **27/27**: rules16 + epochs9 + long-poll2؛JAR مثبت الحجم/SHA256، port loopback مؤقت وowned-process cleanup. لا Firebase CLI. |
| `python3 -m http.server 8000 --bind 127.0.0.1` وخوادم الاختبارات loopback | frontend runtime حقيقي بملفات ساكنة، دون backend build خفي أو hydration. |

لا يوجد build compiler في البنية الحالية. تحقق production runtime محليًا هو تقديم الملفات نفسها واختبارات browser/generated-script؛ أما هوية commit النهائي ونجاح CI/Pages عن بعد فيضيفهما مسؤول الإصدار إلى سجل أعلى الوثيقة. إعادة الإنتاج والقائمة الكاملة للأوامر في [README](../README.md).

## 7. Remaining Risks

1. **حدود capability المقصودة:** possession of sync key هو الصلاحية، ولا توجد حسابات أو أدوار أو إبطال جهاز مستقلًا. هذا نموذج شخصي مشروع إذا حُفظ المفتاح ووافقت الخدمة على هذا النطاق؛ لا يُعتمد تلقائيًا لمتطلبات عضويات أو بيانات منظمة حساسة. المفاتيح اليدوية الطويلة قد تظل ضعيفة التخمين.
2. **Firebase الفعلي غير متحقق:** لا فحص لقواعد المشروع الحي أو عزل المستخدمين أو Firebase quotas/permissions أو بياناته. سياسة emulator ليست deployment. يلزم مشغّل مخوّل يطبق السياسة المناسبة ويختبر بيانات تجريبية حقيقية منفصلة.
3. **Kimi/Drive/Worker الحية:** لم تُختبر مفاتيح مدفوعة أو response headers حقيقية أو صلاحيات حسابات Google أو deployment قديم للجسر/proxy. نشر كود الموقع لا يحدّث الخدمات المنسوخة خارجه تلقائيًا.
4. **Privacy لفرع ANKI العام:** cards/review artifacts علنية وقابلة للنسخ. الاحتفاظ 14 يومًا لا يضمن محو clones أو downloads. المحتوى السري يحتاج قناة تخزين بصلاحيات مناسبة.
5. **Caches تاريخية:** قد تحتوي نسخة العامل القديمة أسئلة bookmark خاصة في Actions caches؛ namespace v2 يمنع restore القديم، لكنه لا يمحو artifacts تاريخية خارج checkout. تحتاج إزالة/انتهاء وفق سياسة المشغّل.
6. **Native Safari/iOS/Edge والأجهزة:** WebKit ليس جهاز iPhone فعليًا، وChromium ليس اختبار Edge native. الميكروفون، Safari WebView storage eviction، Share Sheet، Apple haptics/Shortcuts، وتعدد المناطق/الساعة بين أجهزة حقيقية لم تُختبر بالكامل.
7. **التزامن والتوافق:** Firebase adapter الحالي يفرض epoch CAS واختُبر بSDK حقيقي؛ Web Locks لتوليد AI يظل محليًا للـorigin ولا يوفّر distributed generation lock عالميًا. القواعد المتوافقة لا تجبر جهازًا قديمًا مفتوحًا أو حامل capability يكتب مباشرة على المعاملة؛ يلزم تحديث الأجهزة. Claude adapter merge/create semantics لم تُختبر على منصته. زيادة حمولة root transactions لم تخضع لحمل حي.
8. **Availability والأداء:** يوجد benchmark محلي موثق للمصدر المجمد، ولا يوجد اختبار حمل حي أو SLO/alerting/backup-restore drill أو Core Web Vitals إنتاجي لهذه النسخة. CDN والخدمات الخارجية قد تفشل؛ فحوص الفشل المحلية تقلل الخطر ولا تثبت uptime.
9. **Medical content:** coverage وأعداد/types/key IDs يمكن فحصها؛ صحة المعلومة الطبية، دقة نسبتها إلى الشريحة، وجود إجابة واحدة صحيحة علميًا، ومستوى difficulty تحتاج مراجعة مصدر/مختص.
10. **Accessibility:** منع zoom شرط منتج سابق صريح، وله أثر على ضعاف البصر. أُفصح عنه كاستثناء؛ لا ادعاء امتثال شامل. لم تُنفذ جلسة قارئ شاشة/hardware assistive technology.
11. **Supply chain/headers/proxy:** classic CDN SRI وCSP مفعّلان، لكن modern module tag يحمل SRI، بينما worker URLs الخارجية لا تحمل browser SRI. PDF3 fallback يحمل advisory عاليًا مع تخفيف `isEvalSupported:false` وغياب `unsafe-eval`؛ تبقى ترقية fallback المتوافقة مطلوبة ولا يُدّعى تصحيح package. bridge GET المتوافق قد يحمل bridge token في URL رغم منع Kimi key. DNS hostname validation لا يثبت منع rebinding في كل منصة؛ proxy عام يحتاج allowlist/rate limits مناسبة. GitHub Pages لا يتيح كل HTTP headers من هذه الملفات وحدها. anti-framing وسياسات edge/abuse limits وbranch protection تحتاج إعدادات فعلية مثبتة، وليس مجرد كود محلي.
12. **Anki collection خارج الموقع:** ملف cut/rebuild يحوي العدد المطلوب، لكن استيراده لا يحذف ملاحظات سبق استيرادها ثم حُذفت من الملف. إعادة كتابة stem تغير GUID وقد تضيف note جديدة. المثبت آليًا أن إعادة الملف نفسه لا تكرر الملاحظات؛ وتجربة backend3→2 أبقت3. لا يوجد AnkiConnect أو حذف آلي لبطاقات ومراجعات Anki، وزر حذف الموقع يخص بيانات الموقع.
13. **حدود التدقيق:** scanners الحالية ليست إثباتًا رياضيًا أو تحليلًا كاملًا لتاريخ Git. لا يُفسَّر عدم ظهور exception جديد بأنه عدم وجود bug.

أي فشل باقٍ في الفحوص النهائية، أو فرع إصلاح غير مختبر، يبقى blocker تقنيًا حتى يُصلح ويُعاد التحقق منه؛ لا يُحوّل إلى «minor risk» لإعلان الانتهاء.

## 8. Production Readiness

**التصنيف: NOT READY للإطلاق العام قبل التحقق التشغيلي المبين أعلاه.**

لترقية التصنيف يلزم:

1. ربط نتائج الفحوص المحلية بهوية commit النهائية ومشاهدة remote CI وPages deployment؛ نجحت الجولة النهائية المحلية31/31، بالإضافة إلى Python40/40 وفحوص التثبيت والمصدر. صُححت مسارات متصفحات بيئة الاختبار وfixture الشبكة المحلية ثم أُعيد التشغيل دون تخطي أو تعطيل CSP أو web security. أي تغيير لاحق يستلزم إعادة التحقق المرتبط به.
2. اعتماد نطاق المنتج ونموذج الثقة الحالي بالمفتاح، أو إضافة هوية/تفويض مستقل إذا تطلب الجمهور عضويات وأدوارًا وإبطال أجهزة. لا يلزم افتراض أن كل تطبيق شخصي يحتاج حسابات، ولا الادعاء بأن القواعد الحالية تنفذ متطلبات غير موجودة.
3. مراجعة القواعد والإعدادات الفعلية لـ Firebase والتكاملات، واختبار مجموعة بيانات وحسابات اختبار منفصلة بترخيص مناسب؛ دون استنتاج صحة production من emulator وحده.
4. اعتماد خصوصية job artifacts واحتفاظها، ومتابعة caches القديمة، وحماية الفروع ومراقبة workflows والنسخ الاحتياطية.
5. توثيق الاستثناءات المتبقية وتشغيل تجارب الجهاز/الخدمات التي تؤثر فعلًا على الجمهور المستهدف.

الإصلاحات المحلية وتحسين التغطية تجعل المشروع أقوى بوضوح، لكنها لا تستبدل تحقق التشغيل والسياسات الفعلية. لا تتضمن هذه الوثيقة ضمانًا بأن الموقع «خالٍ تمامًا من الأخطاء».
