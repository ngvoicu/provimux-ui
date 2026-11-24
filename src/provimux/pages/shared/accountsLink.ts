import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export const ACCOUNTS_PATH = '/provimux/accounts';

/** Accounts, opened on one login (its file name): the page opens that account's panel. */
export const accountsAddressOfLogin = (fileName: string): string =>
  `${ACCOUNTS_PATH}?login=${encodeURIComponent(fileName)}`;

/** Accounts, opened on one API key's settings, at its model list's switch (its auth index). */
export const accountsAddressOfKeyLists = (authIndex: string): string =>
  `${ACCOUNTS_PATH}?account=${encodeURIComponent(authIndex)}&settings=lists`;

/** Accounts with the add panel open, on a service when one is given. */
export const accountsAddressToAdd = (service?: string): string =>
  service ? `${ACCOUNTS_PATH}?add=${encodeURIComponent(service)}` : `${ACCOUNTS_PATH}?add=1`;

export function useOpenInAccounts() {
  const navigate = useNavigate();
  return useCallback((fileName: string) => navigate(accountsAddressOfLogin(fileName)), [navigate]);
}
