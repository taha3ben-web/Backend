# توثيق NOVA Ride (Backend)

فهرس التوثيق التقني والتشغيلي للخادم.

## الواجهات (API)

- [نظرة عامّة على الـ API](./api/API_OVERVIEW.md) — البادئة، الإصدار، المصادقة، مغلّف الأخطاء، الصفحات، حدود المعدّل.
- [جرد نقاط النهاية](./api/endpoints.md) — **مُولّد آليًّا**.
- `./api/openapi.json` — OpenAPI 3.1 (مستوى المسارات)، **مُولّد آليًّا**.

لإعادة التوليد بعد تغيير المتحكّمات:

```bash
npm run docs:api
```

## قرارات المعمارية (ADRs)

سجلّ قرارات التصميم المعتمدة في [`architecture/adr/`](./architecture/adr/):

| # | القرار |
|---|---|
| 0001 | [دفتر أستاذ مزدوج القيد للمالية](./architecture/adr/0001-double-entry-ledger.md) |
| 0002 | [نمط Outbox المعاملاتي للأحداث](./architecture/adr/0002-transactional-outbox.md) |
| 0003 | [التحكّم بالوصول عبر RBAC](./architecture/adr/0003-rbac-permissions.md) |
| 0004 | [إصدار الـ API عبر المسار مع التوافق الخلفي](./architecture/adr/0004-uri-versioning.md) |
| 0005 | [قفل مطابقة موزّع للتزامن](./architecture/adr/0005-distributed-matching-lock.md) |
| 0006 | [ضبط فهارس المسارات الساخنة](./architecture/adr/0006-hot-path-index-tuning.md) |
| 0007 | [إدارة الخصومات من لوحة التحكّم حصرًا](./architecture/adr/0007-discounts-dashboard-managed.md) |

## التشغيل (Operations)

- [`../RUNBOOKS.md`](../RUNBOOKS.md) — أدلّة الاستجابة للحوادث والإجراءات الدورية.
