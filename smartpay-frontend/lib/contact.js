// How schools reach SmartPay (the platform owner): for renewals, restoring
// a suspended account, and new schools asking to join. Same details as
// the marketing site (smartpay-marketing/lib/site.js).
export const SMARTPAY_CONTACT = {
  marketingUrl: "https://smartpay-gh.netlify.app",
  whatsapp: "233577428684",
  phoneDisplay: "057 742 8684",
};

export const whatsappLink = (message) =>
  `https://wa.me/${SMARTPAY_CONTACT.whatsapp}?text=${encodeURIComponent(message)}`;
