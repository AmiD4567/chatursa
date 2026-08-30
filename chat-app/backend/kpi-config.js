// Соответствие типов платежей из SQLite показателям ФРС
// Ключ — название типа в колонке `type` таблицы `api_data_cheque_pmnts`
// Можно добавлять/убирать типы по мере необходимости
const KPI_PAYMENT_TYPES = {
  // Наличные → frs_cash
  cash: ['Cash'],

  // Карты (эквайринг) → frs_card
  card: ['Card'],

  // Безналичные переводы (СБП, QR, кредит, предоплата) → frs_transfer
  transfer: [
    'Prepaid',
    'QR',
    'Credit',
    'SBP',
    'Transfer',
    'Online'
  ],

  // Прочие — всё, что не попало в списки выше → frs_other
  // (явно указывать не нужно, это fallback)
};

module.exports = { KPI_PAYMENT_TYPES };
