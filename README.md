# موقع المذاكرة

تطبيق عربي لإدارة جدول المحاضرات وجلسات المذاكرة والمراجعات، تقسيم ملفات المحاضرات، متابعة الاسترجاع والعُقد، وتوليد بطاقات MCQ بصيغة Anki. الواجهة المنشورة: <https://almarhabi.github.io/>.

هذا المستودع تطبيق شخصي يعمل أساسًا داخل المتصفح. المزامنة تستعمل مفتاح مشاركة سريًا، ولا يوجد نظام حسابات أو Firebase Authentication. اقرأ [نموذج الأمان](#نموذج-الأمان-والخصوصية) قبل إضافة مستخدمين أو رفع محتوى حساس، وراجع [تقرير الجاهزية](audit/PRODUCTION_READINESS.md) لنتائج التدقيق وحدود التحقق.

## بنية النظام

| الجزء | التنفيذ الفعلي |
|---|---|
| الواجهة | `index.html`: HTML وCSS وJavaScript عادي، دون React أو Vue أو TypeScript أو bundler. |
| التنقل | عشر شاشات داخل الصفحة: الرئيسية، المساعد، مسيرتي، العروض، الرادار، الاختبارات، الشهر، النوم، الأفكار، الإعدادات. التنقل عبر hash مع Back/Forward. |
| الحالة | الكائن `S`، وعلامات كل محاضرة في `S.marks[id]`. الحفظ المحلي في localStorage، وطابور تعديلات منفصل للمزامنة. |
| التخزين المحلي | IndexedDB: `uqu-ai` لنصوص الشرائح والمجموعات وملف `.apkg`؛ و`uqu-audio` للتسجيلات. |
| المزامنة | Firebase Realtime Database اختياريًا؛ يوجد أيضًا adapter لبيئة Claude التي توفر واجهة قاعدة البيانات الخاصة بها. |
| الذكاء الاصطناعي | Moonshot `kimi-k3` عبر حساب المستخدم، مباشرة أو عبر proxy مناسب. هناك انتظار لحدود الحساب، إلغاء، ومهام قابلة للاستكمال. |
| ملفات المحاضرات | PDF وPowerPoint؛ PDF.js وJSZip تُحمّل عند الحاجة. Google Drive عبر جسر Apps Script ينشره المستخدم في حسابه. |
| ANKI | Python بالمكتبة القياسية فقط: SQLite ثم ZIP. نموذجا البطاقات القديم والجديد مدعومان. |
| العمل في الخلفية | GitHub Actions يفتح نسخة الموقع في Chromium كجهاز إضافي ويزامن النتائج. ليس خادم ويب دائمًا. |
| النشر | GitHub Pages يخدم الملفات الساكنة من `main`؛ لا يلزم خادم Node للواجهة. |
| الاختبارات | Python unittest مع استيراد Anki فعلي، اختبارات Node، Playwright وaxe على محركات متصفح، وFirebase Emulator مستقل. |

مسار بيانات نموذجي:

```text
ملف المحاضرة أو Drive
  → استخراج النص وصفحات الأهداف، مع فواصل الصفحات
  → تقسيم المقاطع أو تحليل الأهداف والمعلومات
  → كتابة أسئلة MCQ وفحص التغطية والجودة والعدد
  → مهمة in/<id>.json في anki-jobs
  → GitHub Actions + Python
  → out/<id>.apkg وout/<id>.json
  → تنزيل الملف ومزامنة مرجعه للأجهزة الأخرى
```

ميزانية البطاقات الأساسية منفصلة عن أسئلة العُقد والنقاط المنسية: الفكرة المختبرة أصلًا لا تُنشأ لها بطاقة إضافية مكررة. الأهداف تُقرأ من بداية **ملف المحاضرة نفسه**. توثيق صيغة المهام والنماذج في [tools/anki/README.md](tools/anki/README.md).

## الملفات المهمة

| المسار | الاستخدام |
|---|---|
| `index.html` | التطبيق، الإعدادات، النصوص المولّدة لجسر Drive وCloudflare Worker، ونسخة برومبت ANKI. |
| `sounds/` وملفات PNG | أصول الواجهة والصوت الساكنة. |
| `tools/anki/` | البرومبت المرجعي، بناء APKG، معالج الطابور واختبارات Python وJavaScript. |
| `tools/runner/` | عامل GitHub، النقل المحلي الآمن، دورة حياة المتصفح، وملف dependencies مقفل. |
| `tools/audit/` | فحوص الصياغة والمنطق والأمن والحالة والواجهات والتوافق. |
| `.github/workflows/validate.yml` | فحوص pull requests ودفعات `main`. |
| `.github/workflows/anki.yml` | بناء دفعات ANKI وحفظ النتائج واستكمال الطابور. |
| `.github/workflows/runner.yml` | مهام AI الخلفية عند الطلب وكل ساعة. |
| `.github/scripts/save-anki.sh` | حفظ فرع المهام مع حماية من تعارض التحديثات. |
| `infra/firebase/` | قواعد capability اختيارية وإعداد اختبار emulator؛ لا تنشر تلقائيًا. |

لا توجد migrations SQL أو Docker أو ORM أو endpoints لتسجيل الدخول داخل هذا المشروع. SQLite هنا جزء من ملف Anki الناتج؛ بيانات التطبيق المتزامنة شجرة JSON في Firebase.

## تشغيل الواجهة محليًا

من جذر المستودع:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

افتح <http://127.0.0.1:8000/>. هذه هي ملفات الواجهة نفسها التي تُنشر؛ لا توجد خطوة build منفصلة أو hydration. قد لا تسمح خدمة خارجية باتصالات localhost بسبب CORS، لذلك تستخدم الاختبارات بدائل معزولة ولا تحتاج مفاتيح المستخدم. الميكروفون وبعض browser APIs تتطلب سياقًا آمنًا ودعمًا من المتصفح.

للعمل على الخادم أو الاختبارات: البيئة المرجعية Node **22.13 أو أحدث** وPython **3.12**، مع Chromium. Firefox وWebKit يُثبتان لاختبارات التوافق. لا تحتاج الواجهة وحدها إلى تثبيت npm dependencies.

## الإعدادات والخدمات الخارجية

تُدخل إعدادات المستخدم من واجهة الموقع، وليس من ملف `.env` يُقرأ داخل المتصفح:

| الإعداد | مكانه ومعناه |
|---|---|
| Firebase web config وsync key | نافذة المزامنة؛ يُحفظان محليًا في `uqu-fb`. مفتاح المسار credential يجب حمايته. |
| مفتاح Kimi والمنطقة | الإعدادات ← 🤖؛ يُحفظ محليًا في `uqu-ai`، ولا يدخل مزامنة الحالة أو النسخة الاحتياطية المعتادة. |
| Drive bridge URL/token والمجلد | الإعدادات ← 🤖 ← Drive. انسخ الجسر من الموقع وانشره في حساب Google الصحيح. |
| Cloudflare proxy | اختياري عند الحاجة إلى CORS؛ الكود المولّد من الإعدادات يجب نشره في خدمة مستقلة. |
| GitHub token | الإعدادات ← 🤖 ← بناء ANKI؛ صلاحية المستودع المحدد وContents: Read and write. يُحفظ على الجهاز فقط. |
| `UQU_RUNNER` | GitHub Actions secret، يُنشأ محتواه عبر «انسخ الإعدادات» في إعدادات العامل. يتضمن credentials لازمة للعامل؛ لا تضعه في المستودع أو سجل التنفيذ. |
| `GH_TOKEN` | token قصير العمر يمرره workflow للعامل من `github.token`. |

متغيرات عامل Node الموثقة: `UQU_RUNNER`، `GH_TOKEN`، `GITHUB_REPOSITORY`، `CHROME_PATH`، `RUNNER_MAX_MIN`، و`RUNNER_STATE`. `RUNNER_HOOK` hook خاص بالاختبارات المحلية. التفاصيل في [توثيق العامل](tools/runner/README.md).

المكتبات المحملة من CDN تشمل Firebase SDK وPDF.js وJSZip والخطوط، وبعض وظائف الصوت الاختيارية. تثبيت npm المقفل لا يزيل اعتماد هذه الوظائف على توفر CDN وسياسة الشبكة. CSP تستعمل بصمة JavaScript المضمّن و`strict-dynamic` لتوافق Firebase long-poll، وclassic scripts المعروفة تتحقق بـ SHA384 SRI؛ modern PDF module يحمل SRI أيضًا، وworkers الخارجية تعتمد على المصدر والإصدار المحددين. بعد أي تعديل في `index.html`، حدّث البصمة ثم شغّل الفحص:

```sh
node tools/audit/csp.cjs --write
node tools/audit/validate.cjs
```

أعد اختبارات المكتبات والمتصفحات عند تغيير loader أو CSP. لا تضف `unsafe-inline` لتجاوز بصمة قديمة.

تنبيه dependency: PDF.js classic fallback3.11.174 يحمل advisory `CVE-2024-4367`. استدعاء PDF يستخدم `isEvalSupported:false` وCSP لا تسمح `unsafe-eval`، فيحدّ ذلك من مسار الاستغلال المعروف، لكن package نفسها لم تُصحح. راجع [التقرير الأمني](audit/PRODUCTION_READINESS.md#3-security-findings) قبل تغيير fallback أو خيارات PDF.

## نموذج الأمان والخصوصية

- المزامنة تعمل كـ **bearer capability**: من يملك sync key يستطيع الوصول إلى `users/<key>` و`audio/<key>` وفق القواعد. لا توجد هوية حساب أو كلمة مرور أو أدوار أو إبطال مستقل لجهاز.
- قواعد deny-by-default المتوافقة موجودة في [infra/firebase](infra/firebase/README.md)، واختُبرت في emulator. وجودها في المستودع لا يثبت أنها منشورة على قاعدة البيانات الفعلية. لا تفتح قراءة الجذر أو parent collections لتشغيل المزامنة أو Shortcut القفل.
- تحديثات Firebase تستخدم transaction بشرط epoch لمنع كتابة جهاز قديم فوق reset أحدث. إعادة reset بنفس epoch لا تمحو تعديلًا وصل بعد إقراره. يلزم تحديث الأجهزة المفتوحة إلى النسخة الحالية؛ العميل القديم أو حامل المفتاح الذي يكتب مباشرة لا يُجبران بهذه القواعد المتوافقة على اتباع البروتوكول الجديد. المعاملة عند جذر المستخدم تزيد حجم النقل مقارنة بتحديث حقل منفرد؛ لم يُقَس حمل حي كثيف.
- رابط المزامنة ورابط Shortcut يحملان صلاحية وصول؛ تعامَل معهما ككلمة مرور. إعداد صفحة عامة لا يحوّل التطبيق تلقائيًا إلى منصة multi-tenant آمنة.
- فرع `anki-jobs` في المستودع العام يحتوي بطاقات وملخص مراجعتها. ملفات النتائج تُزال وفق سياسة الاحتفاظ الحالية بعد 14 يومًا؛ ذلك لا يسحب نسخًا سبق تنزيلها أو نسخها. لا تستخدم هذا المسار لمحتوى سري يتطلب صلاحيات وصول أو حذفًا مضمونًا.
- مفاتيح API الموجودة على الجهاز متاحة للتطبيق الموثوق نفسه؛ حماية XSS، مراجعة الكود والتبعيات، وسلامة الجهاز ضرورية.
- حذف بطاقات الموقع يمسح المراجع والحالة المحفوظة ويمنع نتائج قديمة من الظهور؛ البطاقات المستوردة في تطبيق Anki تُحذف من Anki نفسه. استيراد ملف cut/rebuild لا يحذف الملاحظات الغائبة عن الملف من collection الموجودة، وإعادة صياغة stem قد تضيف note جديدة. إعادة الملف نفسه لا تكرر الملاحظات؛ لا يوجد AnkiConnect أو تنظيف تلقائي لمراجعات Anki.
- راجع السياسات والإعدادات الخارجية قبل إطلاق عام يحتاج حسابات أو بيانات حساسة. لا يحتوي هذا المستودع على ضمان موثّق لصلاحيات production database الفعلية.

## الاختبارات والتحقق

ثبّت dependencies المقفلة دون تشغيل scripts تثبيت غير لازمة:

```sh
npm ci --prefix tools/runner --ignore-scripts
npm ci --prefix tools/audit --ignore-scripts
```

فحوص أساسية دون credentials:

```sh
node tools/audit/validate.cjs
node --check tools/runner/run.mjs
bash -n .github/scripts/save-anki.sh
python3 -m unittest discover -s tools/anki -p 'test_*.py'
node tools/anki/test_objectives.js
node tools/audit/ai-regressions.js
node tools/audit/ai-concurrency.cjs
node tools/audit/ai-boundaries.cjs
node tools/audit/ai-loader.cjs
node tools/audit/integration-regressions.cjs
node tools/audit/state-regressions.cjs
node tools/audit/state-queue.cjs
node tools/audit/state-errors.cjs
node tools/audit/state-clock.cjs
node tools/audit/state-fuzz.cjs
node --test tools/runner/test_runner.mjs tools/runner/test_anki_save.mjs
python3 tools/audit/security-scan.py
node tools/audit/security-repros.js --assert-secure
node tools/audit/security-worker.test.cjs
node tools/audit/security-bridge.test.cjs
node tools/audit/security-gas-client.test.cjs
node tools/audit/security-firebase-config.cjs
```

التحقق الفعلي من استيراد Anki يتطلب dependency اختبار فقط؛ البناء الإنتاجي يبقى بلا مكتبات Python خارجية:

```sh
python3 -m venv /tmp/uqu-anki-tests
/tmp/uqu-anki-tests/bin/python -m pip install --upgrade pip==26.2.2
/tmp/uqu-anki-tests/bin/python -m pip install -r tools/anki/requirements-test.txt
/tmp/uqu-anki-tests/bin/python -m pip check
/tmp/uqu-anki-tests/bin/python -c "import importlib.metadata as m; import anki; assert m.version('anki') == '25.9.5'"
/tmp/uqu-anki-tests/bin/python -W error::ResourceWarning -m unittest discover -s tools/anki -p 'test_*.py'
```

اختبارات المتصفح معزولة عن حسابات المستخدم والخدمات المدفوعة:

```sh
node tools/anki/test_browser.js
node tools/audit/frontend.cjs
node tools/audit/frontend_accessibility.cjs
node tools/audit/frontend_media.cjs
node tools/audit/state-browser.cjs
node tools/audit/state-wipe.cjs
node tools/audit/state-clock-browser.cjs
node tools/audit/ai-tabs.cjs
```

لاختبار المكتبات الفعلية وPDF workers مع CSP الإنتاجية، خزّن أولًا ملفات CDN العامة المثبتة والمتحقق من SHA384 خارج المستودع، ثم اختبرها دون خدمات حية:

```sh
python3 tools/audit/cache-cdn.py
node tools/audit/ai-libraries.cjs
AUDIT_BROWSER=webkit node tools/audit/ai-libraries.cjs
```

المسار الافتراضي `/tmp/uqu-cdn-audit` ويمكن تغييره بـ `AI_CDN_CACHE`. ملء الكاش يحتاج وصولًا عامًا إلى CDN؛ تشغيل التكامل اللاحق يخدم البايتات المتحققة محليًا. WebKit يحتاج binary وsystem libraries موضحة أدناه. نسخة Firefox لهذا الاختبار المعزول لم تحقق شرط انعدام console errors بسبب اعتراض module blob worker في harness؛ لا تُحسب ضمن تحقق نظيف لعمال PDF على Firefox.

يكون Chromium افتراضيًا في `/usr/bin/chromium`؛ حدّد `CHROMIUM_PATH` إذا اختلف المسار. لتثبيت محركات التوافق في بيئة تدعم حزمها ثم تشغيل الاختبارات:

```sh
node tools/runner/node_modules/playwright-core/cli.js install --with-deps firefox webkit
AUDIT_BROWSER=firefox node tools/audit/frontend.cjs
AUDIT_BROWSER=webkit node tools/audit/frontend.cjs
```

تعليمات Firebase Emulator واختبار السياسة دون الوصول إلى production في [infra/firebase/README.md](infra/firebase/README.md). مع Java21 وSDK cache المتحقق، يشغّل harness الرسمي JAR4.11.2 بعد التحقق من حجمه وSHA256، ثم قواعد الوصول وadapter الفعلي وlong-poll في27 حالة؛ يملك العمليات وينظفها، ولا يحتاج Firebase CLI:

```sh
python3 tools/audit/cache-cdn.py
python3 tools/audit/run-firebase.py
```

يستخدم loopback ومشروع `demo-uqu-audit` فقط. مفاتيح ASCII مقبولة الصيغة20–768 حرفًا للحفاظ على التوافق، لكن Firebase يحد المسار **الكامل** بـ768 bytes؛ مفتاح200 متحقق، ومفتاح768 تحت parent لا يعمل. استخدم المفتاح القصير المولد. لا تشغّل اختبارات التكامل على بيانات مستخدم حقيقية. للمراجعة الأمنية للتبعيات:

```sh
npm audit --prefix tools/runner --audit-level=moderate
npm audit --prefix tools/audit --audit-level=moderate
```

لا توجد TypeScript types أو build compiler في هذه البنية؛ فحص JavaScript هنا parsing وcorrectness lint، إضافة إلى الاختبارات التنفيذية. لا يُوصف ذلك بأنه TypeScript typecheck.

للمقارنة المحلية الاختيارية للأداء مع baseline محدد، يستعمل harness عشرة contexts لكل نسخة وCPU4× ويحفظ العينات وهويات المصدر خارج المستودع:

```sh
AUDIT_BASE_REF=e8b0dd6204819245e65e4d8820283250dcbe650c AUDIT_PERF_OUTPUT=/tmp/uqu-performance-audit node tools/audit/performance.cjs
```

اقرأ [منهج القياس وحدوده](audit/PERFORMANCE.md) قبل تفسير النسب؛ النتيجة محلية ولا تشمل خدمات الشبكة أو جهاز هاتف فعلي.

## النشر والتشغيل

- GitHub Pages ينشر الواجهة الساكنة من `main`. راقب نتيجة Pages deployment بدل افتراض أن نجاح commit يعني ظهور النسخة الجديدة فورًا.
- `validate.yml` يتحقق من تغييرات المستودع. تفعيل branch protection واشتراط نجاح الفحوص قرار إعداد GitHub يجب التأكد منه في المستودع الفعلي.
- `runner.yml` يعمل عند `repository_dispatch: work`، يدويًا، وعلى الدقيقة 17 من كل ساعة؛ يحتاج `UQU_RUNNER` لخدمة حقيقية. غيابه no-op مقصود، وتكوينه المشوّه فشل صريح.
- `anki.yml` يعالج المهام على دفعات محدودة، يحفظ الفرع بعملية lease آمنة، ثم يطلب جولة جديدة إذا بقي طابور. تشغيلات المحاكاة المحلية لا تثبت صلاحية token أو خدمة GitHub الفعلية.
- تحديث الكود المضمّن لـ Apps Script أو Cloudflare Worker لا يحدّث deployment سبق نسخه إلى خدمة خارجية؛ يجب على مشغّل الخدمة نشر النسخة المتوافقة.
- عند ترقية العامل، namespace التخزين المؤقت الجديد يتجنب cache قديمًا غير منقّى. راجع caches القديمة في GitHub إذا احتوت سابقًا محتوى خاصًا.

الضبط التشغيلي الحقيقي، الاختبارات المنفذة والقيود المتبقية موثقة في [تقرير Production Readiness](audit/PRODUCTION_READINESS.md). قياس الأداء المحلي وقيوده وبصمة المصدر المجمد المقاس موثقة في [تقرير الأداء](audit/PERFORMANCE.md)؛ لا يثبت تحسن سرعة أو تراجعًا ماديًا في الإنتاج. لا تدّعي هذه الوثائق أن الموقع خالٍ من جميع الأخطاء أو جاهز تلقائيًا لإطلاق متعدد المستخدمين.
