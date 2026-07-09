import { fingerprints, similarity, tokenize } from '../src/coding/plagiarism';

function fp(code: string, lang = 'javascript') {
  return fingerprints(tokenize(code, lang));
}

describe('plagiarism detection', () => {
  const original = `
    function twoSum(nums, target) {
      const seen = new Map();
      for (let i = 0; i < nums.length; i++) {
        const need = target - nums[i];
        if (seen.has(need)) return [seen.get(need), i];
        seen.set(nums[i], i);
      }
      return [];
    }`;

  it('flags near-identical code with only renamed variables', () => {
    const renamed = `
      function twoSum(arr, t) {
        const m = new Map();
        for (let k = 0; k < arr.length; k++) {
          const rem = t - arr[k];
          if (m.has(rem)) return [m.get(rem), k];
          m.set(arr[k], k);
        }
        return [];
      }`;
    expect(similarity(fp(original), fp(renamed))).toBeGreaterThan(0.85);
  });

  it('is robust to reformatting and added comments', () => {
    const reformatted = `function twoSum(nums, target){const seen=new Map();for(let i=0;i<nums.length;i++){// find complement\nconst need=target-nums[i];if(seen.has(need))return [seen.get(need),i];seen.set(nums[i],i);}return [];}`;
    expect(similarity(fp(original), fp(reformatted))).toBeGreaterThan(0.85);
  });

  it('does not flag genuinely different solutions', () => {
    const different = `
      function reverseString(s) {
        return s.split('').reverse().join('');
      }`;
    expect(similarity(fp(original), fp(different))).toBeLessThan(0.3);
  });

  it('returns 0 similarity against empty input', () => {
    expect(similarity(fp(original), new Set())).toBe(0);
  });
});
