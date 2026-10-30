# خط الأساس لحماية اللوحات القائمة (Baseline)

سُجّل هذا الجرد **قبل** أي تغيير في المرحلة 2، ويُستخدم للتحقق من أن الملفات القائمة لم تُمسّ.

| البند | القيمة |
| --- | --- |
| الفرع | `claude/beautiful-einstein-qk6qhf` |
| آخر commit قبل البدء | `04de7b44b348a5d1b5601f9bc98608d865ca8174` (داشبورد المطابقة الصباحية: إعادة ترتيب كروت المؤشرات #7) |
| حالة شجرة العمل عند البدء | نظيفة (0 تغييرات غير محفوظة) |
| إعدادات النشر الموجودة في المستودع | **لا يوجد**: لا `vercel.json` ولا `.vercel/` ولا `package.json` في الجذر. اللوحات ملفات HTML ثابتة (README لوحة Miss Pickup يذكر نشرها على Vercel بإعداد «Framework: Other» من واجهة Vercel، وهو غير مُخزّن في المستودع). |
| ملفات الإنتاج القائمة | 8 ملفات (أدناه) |

## بصمات SHA-256 للملفات القائمة

| الملف | SHA-256 |
| --- | --- |
| `apps-script/Code.gs` | `f7e6a416e5c4cb8485d126166ae58af78bf8c74c0d82de71e54bba9c41d24b56` |
| `index.html` | `63f068dc1240fe5851282006c058549c239ea7fb818eed506db5a89c30772b82` |
| `miss-pickup/README.md` | `dcf6e865bf42bf02381cb3c62a4b24fa16cc6bcac1e6549c722a623744e9375f` |
| `miss-pickup/apps-script/Code.gs` | `ddd52ec502dec32b726239f8ea23ae59fac6cf750ff0b0b0ac5409a5dfa12ae4` |
| `miss-pickup/assets/arrive-logo.png` | `a27e23e3fd9fb405783c77bbdc5004ba2a7b9a94ff030855975b9eb9ac41df03` |
| `miss-pickup/assets/favicon.png` | `aa287324c9d548ba6563c22a8eb1a72da7d22c65b94440a851885a2c02e2987d` |
| `miss-pickup/index.html` | `3269cff05201e9db7503c034b588d9c464508368a59d78162dec603cb7e47218` |
| `miss-pickup/miss_pickup_cases.json` | `541b2a5288bc7086790f8f848edd3ac612f9097a7c37dd93d33ea1b388bea38e` |

## التحقق

من جذر المستودع:

```bash
git diff --stat 04de7b44b348a5d1b5601f9bc98608d865ca8174 -- . ':!agent'
git status --short -- . ':!agent'
```

يجب أن يكون ناتج الأمرين فارغًا. يمكن أيضًا مقارنة بصمات الجدول أعلاه بـ `sha256sum` للملفات.
