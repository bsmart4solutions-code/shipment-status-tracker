/**
 * Default company profile, used until an admin saves one via Settings.
 * Stored in SettingKV under `company.profile`; the printed quotation/invoice
 * and their letterheads read from there so nothing is hardcoded in the UI.
 */
export interface CompanyBankAccount { currency: string; number: string }

export interface CompanyProfile {
  name: string;
  logoDataUrl: string | null; // base64 data URI (travels with the DB — no file storage needed)
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

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
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
    accounts: [
      { currency: 'MYR', number: '' },
      { currency: 'USD', number: '23402000162' },
    ],
    payableTo: 'SOLID XPRESS (M) SDN. BHD.',
  },
};
