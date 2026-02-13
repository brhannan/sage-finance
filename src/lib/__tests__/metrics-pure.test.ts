import { describe, it, expect } from 'vitest';
import { getFIProjection, getHomeBuyingReadiness } from '../metrics';

describe('getFIProjection', () => {
  it('calculates FI number as 25x annual expenses', () => {
    const result = getFIProjection({
      currentSavings: 0,
      annualExpenses: 40000,
      monthlySavings: 2000,
      expectedReturn: 0.07,
    });
    expect(result.fiNumber).toBe(1_000_000);
  });

  it('returns 0 years when already at FI', () => {
    const result = getFIProjection({
      currentSavings: 1_500_000,
      annualExpenses: 40000,
      monthlySavings: 2000,
      expectedReturn: 0.07,
    });
    expect(result.yearsToFI).toBe(0);
  });

  it('accounts for compound growth in projection', () => {
    const withReturn = getFIProjection({
      currentSavings: 100_000,
      annualExpenses: 40000,
      monthlySavings: 2000,
      expectedReturn: 0.07,
    });
    const noReturn = getFIProjection({
      currentSavings: 100_000,
      annualExpenses: 40000,
      monthlySavings: 2000,
      expectedReturn: 0,
    });
    expect(withReturn.yearsToFI).toBeLessThan(noReturn.yearsToFI);
  });

  it('caps at 50 years max', () => {
    const result = getFIProjection({
      currentSavings: 0,
      annualExpenses: 1_000_000,
      monthlySavings: 100,
      expectedReturn: 0.01,
    });
    expect(result.yearsToFI).toBeLessThanOrEqual(50);
  });

  it('returns a valid ISO date string for fiDate', () => {
    const result = getFIProjection({
      currentSavings: 100_000,
      annualExpenses: 40000,
      monthlySavings: 2000,
      expectedReturn: 0.07,
    });
    expect(result.fiDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('higher savings rate reaches FI faster', () => {
    const low = getFIProjection({
      currentSavings: 50_000,
      annualExpenses: 50000,
      monthlySavings: 1000,
      expectedReturn: 0.07,
    });
    const high = getFIProjection({
      currentSavings: 50_000,
      annualExpenses: 50000,
      monthlySavings: 5000,
      expectedReturn: 0.07,
    });
    expect(high.yearsToFI).toBeLessThan(low.yearsToFI);
  });
});

describe('getHomeBuyingReadiness', () => {
  const baseConfig = {
    targetPrice: 500_000,
    downPaymentPercent: 20,
    currentSavings: 50_000,
    monthlyIncome: 10_000,
    monthlyDebts: 500,
  };

  it('calculates down payment needed correctly', () => {
    const result = getHomeBuyingReadiness(baseConfig);
    expect(result.downPaymentNeeded).toBe(100_000);
  });

  it('calculates down payment progress as percentage', () => {
    const result = getHomeBuyingReadiness(baseConfig);
    expect(result.downPaymentProgress).toBe(50);
  });

  it('calculates DTI ratio correctly', () => {
    const result = getHomeBuyingReadiness(baseConfig);
    expect(result.dti).toBe(5);
  });

  it('returns 0 DTI when income is 0', () => {
    const result = getHomeBuyingReadiness({ ...baseConfig, monthlyIncome: 0 });
    expect(result.dti).toBe(0);
  });

  it('caps max monthly payment at 28% of income minus debts', () => {
    const result = getHomeBuyingReadiness(baseConfig);
    expect(result.maxMonthlyPayment).toBe(Math.round(10_000 * 0.28 - 500));
  });

  it('returns affordable price greater than 0 for positive income', () => {
    const result = getHomeBuyingReadiness(baseConfig);
    expect(result.affordablePrice).toBeGreaterThan(0);
  });

  it('returns 0 affordable price when debts exceed 28% of income', () => {
    const result = getHomeBuyingReadiness({
      ...baseConfig,
      monthlyDebts: 5000,
    });
    expect(result.maxMonthlyPayment).toBe(0);
    expect(result.affordablePrice).toBe(0);
  });
});
