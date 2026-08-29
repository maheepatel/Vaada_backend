import type { Commitment } from './types.js';

const stopWords=new Set(['about','after','again','against','being','completed','completion','department','from','government','have','into','more','public','project','promise','state','that','their','there','these','this','through','under','were','will','with']);
const outcomeWords=new Set(['achieved','built','commissioned','complete','completed','delivered','finished','fulfilled','implemented','inaugurated','installed','launched','opened','operational','provided','ready','started']);

function tokens(value:string){return value.toLowerCase().match(/[a-z0-9]+/g)?.filter(token=>(token.length>=4||/^\d{2,}$/.test(token))&&!stopWords.has(token))??[]}

export type ProofLinkAssessment={relevant:boolean;matchedTerms:string[];hasCompletionLanguage:boolean};

export function assessCompletionSource(commitment:Pick<Commitment,'title'|'detail'|'state'|'district'|'accountableOffice'>,sourceText:string):ProofLinkAssessment{
  const sourceTokens=new Set(tokens(sourceText));
  const identityTerms=[...new Set(tokens([commitment.title,commitment.detail,commitment.state,commitment.district,commitment.accountableOffice].join(' ')))];
  const matchedTerms=identityTerms.filter(term=>sourceTokens.has(term)).slice(0,12);
  const hasCompletionLanguage=[...outcomeWords].some(term=>sourceTokens.has(term));
  return{relevant:hasCompletionLanguage&&matchedTerms.length>=3,matchedTerms,hasCompletionLanguage};
}
