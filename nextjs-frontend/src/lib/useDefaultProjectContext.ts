'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

export type DefaultProjectSummary = {
  id: string;
  name: string;
  status: 'active';
  website: string | null;
  platforms: string[];
  aliases: string[];
  primary_keywords: string[];
};

type DefaultProjectContextResponse = {
  success: true;
  data: {
    project: DefaultProjectSummary;
    source: 'SYSTEM_DEFAULT';
  };
};

type DefaultProjectContextState = {
  project: DefaultProjectSummary | null;
  source: 'SYSTEM_DEFAULT' | null;
  loading: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  reload: () => Promise<void>;
};

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('response' in error)) return null;
  const response = (
    error as { response?: { data?: { error?: { code?: unknown } } } }
  ).response;
  const code = response?.data?.error?.code;
  return typeof code === 'string' ? code : null;
}

export default function useDefaultProjectContext(): DefaultProjectContextState {
  const [project, setProject] = useState<DefaultProjectSummary | null>(null);
  const [source, setSource] = useState<'SYSTEM_DEFAULT' | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorCode(null);
    setErrorMessage(null);
    try {
      const response = await axios.get<DefaultProjectContextResponse>(
        '/api/geo-projects/default-context'
      );
      setProject({
        ...response.data.data.project,
        id: String(response.data.data.project.id)
      });
      setSource(response.data.data.source);
    } catch (error) {
      setProject(null);
      setSource(null);
      setErrorCode(readErrorCode(error));
      setErrorMessage(getApiErrorMessage(error, '无法读取默认监控项目'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    project,
    source,
    loading,
    errorCode,
    errorMessage,
    reload
  };
}
