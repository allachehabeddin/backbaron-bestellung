# طلبيات BackBaron

تطبيق ويب يُثبَّت على الجوال (PWA) لكتابة طلبيات الموردين بدل الكتابة باليد، وإرسالها نصاً بالواتساب.
مستقل عن zarython.com وعن أي مشروع آخر.

- الواجهة: `index.html` + `app.js` (بلا بناء ولا Node).
- البيانات وتسجيل الدخول: Firebase (Authentication بالإيميل وكلمة المرور + Firestore).
- الاستضافة: GitHub Pages من هذا المستودع.
- الأصناف تُستورد من `أسعار الموردين.xlsm` بزر «تحديث الأصناف من الإكسل» (أوراق الشركات فيها `company` في Z1).

## قاعدة البيانات (Firestore)

| المسار | المحتوى |
|---|---|
| `catalog/<شركة>` | `{items:[{code,name,unit,pack}], updatedAt, by}` |
| `companies/<شركة>` | `{header, footer, whatsapp, email, askDate}` — تُكتب القيم الأولى تلقائياً أول مرة |
| `drafts/<شركة>` | `{qty:{<مفتاح الصنف>: عدد}}` — مشتركة بين المستخدمين |
| `orders/<id>` | الطلبات المرسلة، مع `by` (من أرسل) — لا تُعدَّل ولا تُحذف |

مفتاح الصنف: `c:<الكود>` أو `n:<الاسم>` إن لم يكن له كود.

## الإعداد مرة واحدة

1. Firebase console → مشروع جديد → Authentication → Email/Password (تفعيل)، ومن Settings → User actions أزل «Enable create (sign-up)».
2. Authentication → Users → أضف حساباً لكل شخص من الثلاثة.
3. Firestore Database → إنشاء (أوروبا، `eur3` أو `europe-west3`) → Rules → الصق محتوى `firestore.rules` → Publish.
4. Project settings → Your apps → Web app → انسخ قيم `firebaseConfig` إلى `firebase-config.js`.
5. Authentication → Settings → Authorized domains → أضف `<اسم-المستخدم>.github.io`.
6. GitHub → مستودع جديد عام `backbaron-bestellung` → Settings → Pages → Branch `main` / root.

## قواعد الرسالة

- الرسالة للمورّد ألمانية كلها؛ أي حرف عربي يوقف أزرار الإرسال.
- جدول واتساب بين ``` بعرض 28 حرفاً (الكود، الاسم، الكراتين)، والاسم الطويل يُكسر تحت عموده.
- الضغط على واتساب يحفظ الطلب ويفرّغ الكميات؛ وضع التجربة (لكل جهاز) لا يحفظ شيئاً.
