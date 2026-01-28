import React, { useEffect, useState } from 'react';
import { supabase, supabaseInitError } from '../supabaseClient';
import { Mail, Lock, ArrowRight, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { ALLOWED_EMAILS, AUTH_ERROR_KEY, RESET_FLOW_KEY } from '../authConfig';

export default function LoginScreen() {
  const [isEmailMode, setIsEmailMode] = useState(false);
  const [authView, setAuthView] = useState<'login' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetStatus, setResetStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

  useEffect(() => {
    if (supabaseInitError) return;
    const storedError = localStorage.getItem(AUTH_ERROR_KEY);
    if (storedError) {
      setError(storedError);
      localStorage.removeItem(AUTH_ERROR_KEY);
    }
  }, []);

  useEffect(() => {
    if (!supabase || supabaseInitError) return;
    const shouldCheckRecovery = hasRecoveryInUrl() || localStorage.getItem(RESET_FLOW_KEY) === '1';
    if (!shouldCheckRecovery) return;
    setAuthView('reset');
    localStorage.setItem(RESET_FLOW_KEY, '1');
    validateRecoveryLink();
  }, []);

  const hasRecoveryInUrl = () => {
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
    const searchParams = new URLSearchParams(window.location.search);
    const type = hashParams.get('type') || searchParams.get('type');
    return type === 'recovery' || hashParams.has('access_token') || searchParams.has('code');
  };

  const clearRecoveryUrl = () => {
    if (!window.location.hash && !window.location.search) return;
    const nextUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, nextUrl);
  };

  const validateRecoveryLink = async () => {
    if (!supabase) return;
    setError('');
    setInfo('');
    setResetStatus('checking');

    try {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) {
        setResetStatus('invalid');
        setError('Link inválido ou expirado. Solicite um novo link de redefinição.');
        return;
      }

      const userEmail = data.session.user?.email ?? '';
      if (userEmail && !ALLOWED_EMAILS.includes(userEmail)) {
        await supabase.auth.signOut();
        setResetStatus('invalid');
        setError('Acesso restrito. Este e-mail não tem permissão para acessar o ColdFlow.');
        return;
      }

      setResetStatus('valid');
      clearRecoveryUrl();
    } catch (err: any) {
      console.error('Recovery validation failed', err);
      setResetStatus('invalid');
      setError('Link inválido ou expirado. Solicite um novo link de redefinição.');
    }
  };

  const checkAndAllowUser = async (userEmail: string | null) => {
    if (!supabase) return false;
    if (!userEmail || !ALLOWED_EMAILS.includes(userEmail)) {
      await supabase.auth.signOut();
      setError('Acesso restrito. Este e-mail não tem permissão para acessar o ColdFlow.');
      setLoading(false);
      return false;
    }
    return true;
  };

  const handleGoogleLogin = async () => {
    if (!supabase) return;
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (signInError) throw signInError;
    } catch (err: any) {
      console.error("Login failed", err);
      setError('Erro ao conectar com Google. Tente novamente.');
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    if (!ALLOWED_EMAILS.includes(email)) {
       setError('Acesso restrito. E-mail não autorizado.');
       setLoading(false);
       return;
    }

    try {
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      await checkAndAllowUser(data.user?.email ?? null);
    } catch (err: any) {
      console.error("Email login failed", err);
      if (err?.message?.toLowerCase().includes('invalid') || err?.status === 400) {
        setError('E-mail ou senha incorretos.');
      } else {
        setError('Erro ao fazer login. Tente novamente.');
      }
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!forgotEmail) {
      setError('Informe o e-mail para continuar.');
      return;
    }
    if (!ALLOWED_EMAILS.includes(forgotEmail)) {
      setError('Acesso restrito. E-mail não autorizado.');
      return;
    }

    setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase not configured');
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: window.location.origin
      });
      if (resetError) throw resetError;
      setInfo('Enviamos um link de redefinição para seu e-mail. Verifique a caixa de entrada.');
    } catch (err: any) {
      console.error('Reset password request failed', err);
      setError('Não foi possível enviar o link. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (resetPassword.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase not configured');
      const { error: updateError } = await supabase.auth.updateUser({ password: resetPassword });
      if (updateError) throw updateError;

      setInfo('Senha atualizada com sucesso. Faça login novamente.');
      localStorage.removeItem(RESET_FLOW_KEY);
      window.dispatchEvent(new Event('coldflow-reset-flow'));
      await supabase.auth.signOut();
      setAuthView('login');
      setIsEmailMode(true);
      setResetPassword('');
      setResetConfirm('');
    } catch (err: any) {
      console.error('Update password failed', err);
      setError('Não foi possível atualizar a senha. O link pode ter expirado.');
      setResetStatus('invalid');
    } finally {
      setLoading(false);
    }
  };

  if (supabaseInitError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h1 className="text-lg font-bold text-gray-900 mb-2">Configuração incompleta</h1>
          <p className="text-sm text-gray-600">{supabaseInitError}</p>
          <p className="text-xs text-gray-400 mt-2">Configure o Supabase e recarregue.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center overflow-hidden relative font-sans">
      
      {/* --- ANIMATION ELEMENTS --- */}
      
      {/* 1. STRONG GUST (The Trigger) - Starts at 2s - INITIALLY INVISIBLE */}
      <div className="absolute w-full h-full pointer-events-none overflow-hidden z-20">
        <div className="absolute top-[48%] left-0 w-[50%] h-1 bg-gradient-to-r from-transparent via-blue-200 to-transparent animate-wind-gust opacity-0"></div>
        <div className="absolute top-[52%] left-0 w-[70%] h-1.5 bg-gradient-to-r from-transparent via-blue-300 to-transparent animate-wind-gust opacity-0" style={{ animationDelay: '2.05s' }}></div>
        <div className="absolute top-[50%] left-0 w-[40%] h-1 bg-gradient-to-r from-transparent via-white to-transparent animate-wind-gust opacity-0" style={{ animationDelay: '2.1s' }}></div>
      </div>
      
      {/* 2. ICE GROUP (Melting Center -> Moves out when Gust hits) */}
      <div className="absolute z-20 animate-ice-out">
        <div className="relative flex items-center justify-center w-40 h-40">
           
           {/* Puddle - Starts small, grows */}
           <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-28 h-6 bg-blue-300/40 blur-md rounded-[100%] animate-puddle-grow"></div>

           {/* Ice Cube */}
           <svg 
             viewBox="0 0 200 200" 
             className="w-full h-full animate-ice-float drop-shadow-xl"
             style={{ filter: 'drop-shadow(0px 10px 20px rgba(59, 130, 246, 0.25))' }}
           >
              <defs>
                 <linearGradient id="iceBody" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                    <stop offset="40%" stopColor="#e0f2fe" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.8" />
                 </linearGradient>
              </defs>

              <path 
                d="M45,35 Q25,25 25,60 L35,145 Q40,165 70,160 L150,150 Q175,145 165,110 L155,40 Q150,15 110,20 Z" 
                fill="url(#iceBody)" 
                stroke="rgba(255,255,255,0.9)" 
                strokeWidth="2"
              />

              <path d="M45,35 Q60,30 110,20 Q130,22 135,45 Q100,50 60,55 Q35,50 45,35" fill="white" fillOpacity="0.6" />
              <path d="M165,110 L150,150 Q130,140 120,100 L155,40" fill="#60a5fa" fillOpacity="0.15" style={{ mixBlendMode: 'multiply' }} />
              
              {/* Extra Sweat Drops - Melting Effect */}
              <circle cx="50" cy="80" r="3" fill="#e0f2fe" className="animate-drop-1" />
              <circle cx="130" cy="110" r="2.5" fill="#e0f2fe" className="animate-drop-2" />
              <circle cx="80" cy="90" r="2" fill="#e0f2fe" className="animate-drop-3" />
              <circle cx="110" cy="130" r="3" fill="#e0f2fe" className="animate-drop-4" />
           </svg>
        </div>
      </div>

      {/* --- LOGIN FORM --- */}
      <div className="relative z-10 w-full max-w-sm px-6 flex flex-col items-center opacity-0 animate-logo-reveal">
        
        <div className="mb-8 text-center">
          <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center text-white font-bold shadow-2xl shadow-blue-200/50 text-2xl mx-auto mb-4 border border-gray-700">
            CF
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-gray-900 drop-shadow-sm mb-1">
            ColdFlow
          </h1>
          <p className="text-blue-500 text-sm font-semibold tracking-widest uppercase">
            Acesso Restrito
          </p>
        </div>

        <div className="w-full opacity-0 animate-fade-in-up bg-white/80 backdrop-blur-xl border border-white rounded-3xl shadow-xl p-6 md:p-8">
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-xs text-red-600 font-medium animate-pulse">
               <AlertTriangle size={16} className="shrink-0 mt-0.5" />
               {error}
            </div>
          )}
          {info && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-2 text-xs text-emerald-600 font-medium">
               <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
               {info}
            </div>
          )}

          {authView === 'login' && !isEmailMode ? (
            <div className="space-y-4">
              <button 
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full group relative px-6 py-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-200 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
              >
                {loading ? <Loader2 className="animate-spin text-blue-600" /> : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    <span className="font-bold text-gray-700 group-hover:text-gray-900">Continuar com Google</span>
                  </>
                )}
              </button>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-gray-200"></div>
                <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-medium uppercase">Ou entre com e-mail</span>
                <div className="flex-grow border-t border-gray-200"></div>
              </div>

              <button 
                onClick={() => setIsEmailMode(true)}
                className="w-full py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <Mail size={18} /> Usar E-mail e Senha
              </button>
            </div>
          ) : authView === 'login' ? (
            <form onSubmit={handleEmailLogin} className="space-y-4">
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Seu E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nome@empresa.com"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-gray-900"
                      required
                    />
                  </div>
               </div>
               
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-gray-900"
                      required
                    />
                  </div>
               </div>

               <button 
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl font-bold shadow-lg shadow-gray-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
               >
                  {loading ? <Loader2 className="animate-spin" /> : <>Entrar no Sistema <ArrowRight size={18} /></>}
               </button>

               <button
                  type="button"
                  onClick={() => {
                    setAuthView('forgot');
                    setForgotEmail(email);
                    setError('');
                    setInfo('');
                  }}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-800 font-semibold py-1"
               >
                  Esqueceu a senha?
               </button>

               <button 
                  type="button"
                  onClick={() => setIsEmailMode(false)}
                  className="w-full text-center text-xs text-gray-500 hover:text-gray-800 font-medium py-2"
               >
                  Voltar para opções
               </button>
            </form>
          ) : authView === 'forgot' ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">E-mail de recuperação</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="nome@empresa.com"
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-gray-900"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl font-bold shadow-lg shadow-gray-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                {loading ? <Loader2 className="animate-spin" /> : <>Enviar link de redefinição <ArrowRight size={18} /></>}
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthView('login');
                  setError('');
                  setInfo('');
                }}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-800 font-medium py-2"
              >
                Voltar para login
              </button>
            </form>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="text-xs text-gray-500 font-semibold uppercase tracking-widest">
                Redefinição de senha
              </div>

              {resetStatus === 'checking' && (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} /> Validando link...
                </div>
              )}

              {resetStatus === 'invalid' ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Não conseguimos validar este link. Solicite um novo para continuar.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem(RESET_FLOW_KEY);
                      window.dispatchEvent(new Event('coldflow-reset-flow'));
                      setAuthView('forgot');
                      setError('');
                      setInfo('');
                    }}
                    className="w-full mt-2 bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl font-bold shadow-lg shadow-gray-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    Solicitar novo link <ArrowRight size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Nova senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="Mínimo 8 caracteres"
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-gray-900"
                        required
                        disabled={resetStatus !== 'valid'}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Confirmar senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input
                        type="password"
                        value={resetConfirm}
                        onChange={(e) => setResetConfirm(e.target.value)}
                        placeholder="Repita a nova senha"
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-gray-900"
                        required
                        disabled={resetStatus !== 'valid'}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || resetStatus !== 'valid'}
                    className="w-full mt-2 bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl font-bold shadow-lg shadow-gray-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" /> : <>Atualizar senha <ArrowRight size={18} /></>}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(RESET_FLOW_KEY);
                  window.dispatchEvent(new Event('coldflow-reset-flow'));
                  setAuthView('login');
                  setError('');
                  setInfo('');
                }}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-800 font-medium py-2"
              >
                Voltar para login
              </button>
            </form>
          )}

        </div>
        
        <div className="mt-8 text-center opacity-0 animate-fade-in-up" style={{ animationDelay: '3s' }}>
          <p className="text-[10px] text-gray-400 font-medium">
             Sistema Privado &copy; {new Date().getFullYear()} ColdFlow.
          </p>
        </div>

      </div>
    </div>
  );
}
