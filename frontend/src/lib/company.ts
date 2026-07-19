/**
 * Company profile type + fallback defaults for printed documents.
 * The live values come from GET /settings/company (editable in Settings);
 * these defaults are only used before the API responds or if it fails.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CompanyBankAccount { currency: string; number: string }

export interface CompanyProfile {
  name: string;
  logoDataUrl: string | null;
  addressLines: string[];
  tel: string;
  fax: string;
  email: string;
  website: string;
  coNo: string;
  sstId: string;
  bank: {
    bank: string;
    branch: string;
    swift: string;
    accounts: CompanyBankAccount[];
    payableTo: string;
  };
}

export const DEFAULT_COMPANY: CompanyProfile = {
  name: 'SOLID XPRESS (M) SDN. BHD.',
  logoDataUrl: null,
  addressLines: [
    'No. 9-1, Lorong Batu Nilam 3F, Bandar Bukit Tinggi,',
    '41200 Klang, Selangor Darul Ehsan, Malaysia.',
  ],
  tel: '603-9213 1378, 603-9213 1376',
  fax: '',
  email: 'michelle@solidxpress.com.my/cs1@solidxpress.com.my/cs2@solidxpress.com.my',
  website: '',
  coNo: '201701006300 (1220465-K)',
  sstId: 'B10-1902-32000071',
  bank: {
    bank: 'HONG LEONG BANK BERHAD',
    branch: 'BANDAR BOTANIC, SELANGOR',
    swift: 'HLBBMYKL',
    accounts: [{ currency: 'MYR', number: '' }, { currency: 'USD', number: '23402000162' }],
    payableTo: 'SOLID XPRESS (M) SDN. BHD.',
  },
};

/** Fetch the live company profile, falling back to defaults. */
export function useCompany(): CompanyProfile {
  const { data } = useQuery({ queryKey: ['company-profile'], queryFn: () => api<CompanyProfile>('/settings/company') });
  return data ?? DEFAULT_COMPANY;
}

/** Standard T&C printed at the foot of every quotation (FMFF terms). */
export const QUOTATION_TERMS = [
  'All business undertake is subject to standard trading conditions of the Federation of Malaysian Freight Forwarders, copy available upon request.',
  'The above quotation is subject to change with / without prior notice.',
  'We shall not insure your goods unless specific written instruction are given by you.',
  'Insurance cover is at the responsibility of your company. Insurance policy is to cover all risks, with contractor(s) and sub-contractor(s) included as joint insured party(ies) failing which the subrogation waiver clause must be included in the insurance policy.',
  'Freight charges, customs duties (if any), port charges, storage and haulage fee are to be paid in advance of clearance of goods. Other fees and charges as stated above are payable within 7 days from invoice date.',
  'To avoid incurring storage, demurrage, removal and detention charges, etc., all relevant shipping documents should be received at our office at least 72 hours before the arrival of the vessel, or earlier.',
  'All rate quoted excludes insurance, sales tax and custom duty (if any).',
  'Rates quoted excludes oversized, over length cargo, storage, warehouse charges, demurrage, forklift and carnage.',
  'The rate quoted applicable for GENERAL CARGO only.',
  'The rate quoted subject to 6% SST except Ocean Freight.',
  'The quoted rate excludes cess and any other miscellaneous charges, which will be billed on a back-to-back basis.',
  'Any surcharges imposed by the Carrier or Co-loader shall be billed on a back-to-back basis.',
  'All rates quoted are subject to space availability.',
];

/** Standard note + FMFF condition printed at the foot of the tax invoice. */
export const INVOICE_FOOTER = {
  computerGeneratedNote: '*** This is a computer generated invoice, no signature is required. ***',
  chequeNote: 'ALL CHEQUE MUST BE CROSSED AND PAYABLE TO "SOLID XPRESS (M) SDN. BHD."',
  tradingCondition:
    "Trading will be subjected to the current Federation of Malaysian Freight Forwarders' (FMFF) Standard Trading Conditions (STC) available in full text on request.",
};
