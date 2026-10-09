// =========================================================================
// 🎯 TikTok Events API (eAPI) Serverless Function
// -------------------------------------------------------------------------
// Vercel Serverless Function - 서버에서 직접 TikTok으로 이벤트 전송
// → iOS 광고 차단 우회, 광고 최적화 품질 향상 (TikTok 공식: CPA 15% 향상)
// -------------------------------------------------------------------------
// 환경변수 (Vercel Dashboard → Settings → Environment Variables):
//   TIKTOK_PIXEL_ID       = DB48JHBC77U534NEKCC0
//   TIKTOK_ACCESS_TOKEN   = (TikTok에서 발급받은 Access Token)
//   TIKTOK_TEST_EVENT_CODE= (선택: 테스트 모드 시 사용)
// =========================================================================

import crypto from 'crypto';

// SHA-256 해싱 (PII 정보 암호화 - TikTok 필수 요구사항)
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

  const PIXEL_ID = process.env.TIKTOK_PIXEL_ID;
  const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
  const TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE; // 선택

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('❌ TikTok 환경변수 누락:', { PIXEL_ID: !!PIXEL_ID, ACCESS_TOKEN: !!ACCESS_TOKEN });
    return res.status(500).json({ error: 'TikTok server not configured' });
  }

  try {
    const {
      event_name,        // 'ViewContent' | 'Lead' | 'CompleteRegistration' 등
      event_id,          // 중복 제거용 유니크 ID (Pixel과 동일값)
      event_source_url,  // 발생 페이지 URL
      ttclid,            // TikTok Click ID (쿠키/URL 파라미터)
      ttp,               // TikTok Pixel ID 쿠키
      email,             // 선택: 상담 시 받은 이메일
      phone,             // 선택: 상담 시 받은 전화번호
      external_id,       // 선택: 사용자 식별자
      properties = {},   // 선택: 추가 데이터 (content_id, value, currency 등)
    } = req.body;

    if (!event_name) return res.status(400).json({ error: 'event_name required' });

    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const eventTime = Math.floor(Date.now() / 1000);
    const finalEventId = event_id || `${event_name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ===== TikTok Events API v1.3 페이로드 =====
    const eventPayload = {
      event_source: 'web',
      event_source_id: PIXEL_ID,
      ...(TEST_EVENT_CODE && { test_event_code: TEST_EVENT_CODE }),
      data: [
        {
          event: event_name,
          event_time: eventTime,
          event_id: finalEventId,
          user: {
            ...(email && { email: sha256(email) }),
            ...(phone && { phone: sha256(phone.replace(/[^0-9]/g, '')) }),
            ...(external_id && { external_id: sha256(external_id) }),
            ...(ttclid && { ttclid }),
            ...(ttp && { ttp }),
            ip: clientIp,
            user_agent: userAgent,
          },
          properties: {
            ...properties,
          },
          page: {
            url: event_source_url || req.headers.referer || '',
          },
        },
      ],
    };

    // ===== TikTok Business API 호출 =====
    const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': ACCESS_TOKEN,
      },
      body: JSON.stringify(eventPayload),
    });

    const result = await response.json();

    // TikTok 응답: code=0 이면 성공, 다른 숫자면 에러
    if (result.code !== 0) {
      console.error('❌ TikTok eAPI 에러:', result);
      return res.status(400).json({
        error: 'TikTok API error',
        detail: result,
      });
    }

    console.log(`✅ TikTok eAPI 전송 성공: ${event_name}`, { event_id: finalEventId });
    return res.status(200).json({
      success: true,
      event_id: finalEventId,
      tiktok_response: result,
    });
  } catch (err) {
    console.error('❌ TikTok eAPI 핸들러 에러:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
