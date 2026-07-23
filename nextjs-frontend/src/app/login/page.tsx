// @ts-nocheck
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Login from '@/components/Login';

export default function LoginPage() {
  const router = useRouter();

  const handleLogin = ({ token: tk, user }) => {
    localStorage.setItem('agd_token', tk);
    localStorage.setItem('agd_user', JSON.stringify(user || null));
    if (user?.id) localStorage.setItem('agd_user_id', String(user.id));
    router.push('/geo');
  };

  return <Login onLogin={handleLogin} />;
}
