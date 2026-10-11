/* Conservative merchant-fulfilled profit estimate. All user-facing prices are yen incl. tax. */
(() => {
  'use strict';
  const fixed = value => Math.round(value * 100) / 100;
  const nonnegative = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const profileFor = category => category === 'コーヒー' || category === 'サプリ・粉末食品など'
    ? 'grocery'
    : category === '観賞魚・ペット' ? 'pet' : 'beauty';
  const referralRate = (profile, grossSales) => {
    if (grossSales <= 750) return 5;
    if (grossSales <= 1500) return 8.4;
    return profile === 'pet' ? 15.4 : 10.4;
  };
  function estimate(input) {
    const sale = nonnegative(input.salePrice);
    const buy = nonnegative(input.buyPrice);
    const inbound = nonnegative(input.buyShipping);
    const outbound = nonnegative(input.outboundShipping);
    const packing = nonnegative(input.packagingCost);
    const points = nonnegative(input.pointsCost ?? 0);
    if ([sale, buy, inbound, outbound, packing, points].some(value => value === null) || points > sale) return null;
    const rate = input.manualReferralRate === '' || input.manualReferralRate == null
      ? referralRate(input.profile || 'beauty', sale)
      : nonnegative(input.manualReferralRate);
    if (rate === null || rate > 100) return null;
    const observedFee = nonnegative(input.observedFeeYen);
    const useObservedFee = observedFee !== null && (input.manualReferralRate === '' || input.manualReferralRate == null);
    const referralBeforeTax = useObservedFee ? observedFee : Math.max(30, sale * rate / 100);
    const referralFee = Math.ceil(referralBeforeTax * 1.1);
    const planFee = input.plan === 'individual' ? 110 : 0;
    const fees = referralFee + planFee;
    const profit = sale - points - buy - inbound - outbound - packing - fees;
    return { sale, points, buy, inbound, outbound, packing, rate, referralFee, planFee, fees, feeSource: useObservedFee ? 'sp_api_estimate' : 'category_rate', profit: fixed(profit), margin: sale ? fixed(profit / sale * 100) : null };
  }
  window.NEKOPOST_FINANCE = { estimate, profileFor, referralRate };
})();
