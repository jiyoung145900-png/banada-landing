// =========================================================================
// 🎯 Meta Conversion API (CAPI) Serverless Function
// -------------------------------------------------------------------------
// Vercel Serverless Function - 서버에서 직접 Meta로 이벤트 전송
// → iOS 광고 차단 우회, 광고 최적화 품질 20~40% 향상
// -------------------------------------------------------------------------
// 환경변수 (Vercel Dashboard → Settings → Environment Variables):
//   META_PIXEL_ID         = 1073540018723521
//   META_CAPI_TOKEN       = (Meta에서 발급받은 Access Token)
//   META_TEST_EVENT_CODE  = (선택: 테스트 모드 시 사용)
// =========================================================================

import crypto from 'crypto';

// SHA-256 해싱 (PII 정보 암호화 - Meta 필수 요구사항)
function sha256(value) {
  if (!value) return undefined;
  return crypto
    .createHash('sha256')
    .update(value.toString().toLowerCase().trim())
    .digest('hex');
}

// 클라이언트 IP 추출 (Vercel 환경)
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

export default async function handler(req, res) {
  // ===== CORS 설정 =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
  const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE; // 선택

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('❌ 환경변수 누락:', { PIXEL_ID: !!PIXEL_ID, ACCESS_TOKEN: !!ACCESS_TOKEN });
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const {
      event_name,        // 'PageView' | 'ViewContent' | 'Lead' 등
      event_id,          // 중복 제거용 유니크 ID (Pixel과 동일값)
      event_source_url,  // 발생 페이지 URL
      fbp,               // 쿠키 _fbp 값
      fbc,               // 쿠키 _fbc 값
      email,             // 선택: 상담 시 받은 이메일
      phone,             // 선택: 상담 시 받은 전화번호
      custom_data = {},  // 선택: 추가 데이터
    } = req.body;

    if (!event_name) return res.status(400).json({ error: 'event_name required' });

    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // ===== Meta CAPI 이벤트 페이로드 =====
    const eventPayload = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: event_id || `${event_name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      event_source_url: event_source_url || req.headers.referer,
      action_source: 'website',
      user_data: {
        client_ip_address: clientIp,
        client_user_agent: userAgent,
        ...(fbp && { fbp }),
        ...(fbc && { fbc }),
        ...(email && { em: [sha256(email)] }),
        ...(phone && { ph: [sha256(phone.replace(/[^0-9]/g, ''))] }),
      },
      custom_data,
    };

    const requestBody = {
      data: [eventPayload],
      ...(TEST_EVENT_CODE && { test_event_code: TEST_EVENT_CODE }),
    };

    // ===== Meta Graph API 호출 =====
    const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Meta CAPI 에러:', result);
      return res.status(response.status).json({ error: 'Meta API error', detail: result });
    }

    console.log(`✅ CAPI 전송 성공: ${event_name}`, { event_id: eventPayload.event_id });
    return res.status(200).json({
      success: true,
      events_received: result.events_received,
      event_id: eventPayload.event_id,
    });
  } catch (err) {
    console.error('❌ CAPI 핸들러 에러:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
