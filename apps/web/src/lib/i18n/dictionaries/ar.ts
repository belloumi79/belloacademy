/**
 * Dictionnaire arabe (partiel, volontairement) — démonstration de
 * l'extensibilité multilingue et du rendu RTL (`dir="rtl"`).
 * Les clés absentes retombent automatiquement sur le français.
 */

import type { TranslationDictionary } from "./fr";

export const ar: Partial<TranslationDictionary> = {
  "app.tagline": "منصة التكوين عبر الإنترنت للمدارس ومراكز التكوين والمكوّنين المستقلين",
  "nav.home": "الرئيسية",
  "nav.catalog": "الكاتالوغ",
  "nav.dashboard": "لوحة التحكم",
  "nav.courses": "الدورات",
  "nav.learn": "دوراتي",
  "nav.live": "الحصص المباشرة",
  "nav.assessments": "التقييمات",
  "nav.certificates": "الشهادات",
  "nav.billing": "الاشتراك",
  "nav.organization": "المؤسسة",
  "nav.login": "تسجيل الدخول",
  "nav.register": "إنشاء حساب",
  "nav.logout": "تسجيل الخروج",

  "common.search": "بحث",
  "common.filter": "تصفية",
  "common.save": "حفظ",
  "common.cancel": "إلغاء",
  "common.create": "إنشاء",
  "common.edit": "تعديل",
  "common.delete": "حذف",
  "common.loading": "جارٍ التحميل…",
  "common.empty": "لا يوجد عنصر لعرضه",
  "common.free": "مجاني",
  "common.level": "المستوى",
  "common.language": "اللغة",
  "common.duration": "المدة",
  "common.status": "الحالة",
  "common.email": "البريد الإلكتروني",
  "common.password": "كلمة المرور",
  "common.name": "الاسم الكامل",
  "common.error": "حدث خطأ.",

  "auth.login.title": "تسجيل الدخول",
  "auth.login.submit": "تسجيل الدخول",
  "auth.register.title": "إنشاء حساب",
  "auth.register.submit": "إنشاء حسابي",

  "catalog.title": "كاتالوغ الدورات",
  "catalog.subtitle": "ابحث حسب العنوان أو الفئة أو المستوى أو اللغة.",
  "catalog.empty": "لا توجد دورة مطابقة لبحثك.",

  "course.enroll": "التسجيل في هذه الدورة",
  "course.progress": "التقدم",
  "course.objectives": "الأهداف البيداغوجية",
  "course.prerequisites": "المتطلبات المسبقة",

  "live.title": "الحصص المباشرة",
  "live.join": "الانضمام إلى الحصة",
  "live.status.scheduled": "مبرمجة",
  "live.status.live": "جارية",
  "live.status.ended": "منتهية",
  "live.status.cancelled": "ملغاة",

  "assessment.title": "التقييمات",
  "assessment.start": "ابدأ",
  "assessment.submit": "إرسال",
  "assessment.score": "النتيجة",
  "assessment.passed": "ناجح",
  "assessment.failed": "غير ناجح",

  "certificate.title": "الشهادات",
  "certificate.verify": "التحقق من شهادة",
  "certificate.valid": "هذه الشهادة صحيحة.",

  "billing.title": "الاشتراك والفوترة",
  "billing.plans": "الخطط المتاحة",

  "errors.unauthorized": "المصادقة مطلوبة.",
  "errors.forbidden": "تم رفض الوصول.",
  "errors.notFound": "المورد غير موجود.",
  "errors.server": "حدث خطأ داخلي. أعد المحاولة لاحقًا.",
};
