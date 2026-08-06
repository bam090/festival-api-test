const TOUR_API_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
const KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";
const REQUEST_TIMEOUT_MS = 15000;

const PLACE_CATEGORIES = [
  { code: "FD6", name: "음식점" },
  { code: "CE7", name: "카페" },
  { code: "AD5", name: "숙박" },
];

const $ = (selector) => document.querySelector(selector);

function getInputValue(selector) {
  return $(selector).value.trim();
}

function requireInput(selector, name) {
  const value = getInputValue(selector);
  if (!value) throw new Error(`${name} 값을 입력하세요.`);
  return value;
}

function redactSecrets(message) {
  const secretSelectors = ["#tour-key", "#kakao-key", "#supabase-key", "#supabase-password"];

  return secretSelectors.reduce((safeMessage, selector) => {
    const secret = getInputValue(selector);
    return secret ? safeMessage.split(secret).join("[REDACTED]") : safeMessage;
  }, String(message));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function setResult(selector, status, message, data) {
  const box = $(selector);
  box.dataset.status = status;
  box.textContent = message;

  if (data !== undefined) {
    const pre = document.createElement("pre");
    pre.textContent = formatJson(data);
    box.appendChild(pre);
  }
}

function getErrorMessage(payload, fallback) {
  const tourError = payload?.OpenAPI_ServiceResponse?.cmmMsgHeader;

  return (
    payload?.error?.message ||
    payload?.message ||
    payload?.msg ||
    payload?.response?.header?.resultMsg ||
    tourError?.returnAuthMsg ||
    tourError?.errMsg ||
    fallback
  );
}

function getXmlErrorMessage(text) {
  if (!text || typeof DOMParser === "undefined") return "";

  const xml = new DOMParser().parseFromString(text, "application/xml");
  const errorTags = ["returnAuthMsg", "errMsg", "resultMsg"];

  for (const tag of errorTags) {
    const message = xml.querySelector(tag)?.textContent?.trim();
    if (message) return message;
  }

  return "";
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    let nonJsonError = "";

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
      nonJsonError = getXmlErrorMessage(text);
    }

    if (!response.ok) {
      throw new Error(
        getErrorMessage(payload, nonJsonError || `HTTP ${response.status} ${response.statusText}`),
      );
    }

    if (!payload) {
      throw new Error(nonJsonError || "JSON 응답을 받지 못했습니다.");
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${REQUEST_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readTourResponse(payload) {
  const response = payload?.response;
  const resultCode = String(response?.header?.resultCode ?? "");

  if (!response) {
    throw new Error("TourAPI 응답 구조를 확인할 수 없습니다.");
  }

  if (resultCode && resultCode !== "0000") {
    throw new Error(response.header.resultMsg || `TourAPI 오류 코드: ${resultCode}`);
  }

  return response.body;
}

function buildTourUrl(path, serviceKey, params = {}) {
  const url = new URL(`${TOUR_API_BASE_URL}/${path}`);
  const searchParams = new URLSearchParams({
    MobileOS: "ETC",
    MobileApp: "FestivalApiTest",
    _type: "json",
    serviceKey,
    ...params,
  });
  url.search = searchParams.toString();
  return url;
}

async function fetchFestivals(serviceKey, startDate, endDate) {
  const url = buildTourUrl("searchFestival2", serviceKey, {
    eventStartDate: startDate,
    eventEndDate: endDate,
    arrange: "A",
    pageNo: "1",
    numOfRows: "20",
  });
  const payload = await requestJson(url);
  const body = readTourResponse(payload);
  return asArray(body?.items?.item);
}

async function fetchFestivalDetail(serviceKey, contentId) {
  const url = buildTourUrl("detailCommon2", serviceKey, {
    contentId: String(contentId),
    pageNo: "1",
    numOfRows: "10",
  });
  const payload = await requestJson(url);
  const body = readTourResponse(payload);
  return asArray(body?.items?.item)[0] ?? null;
}

async function fetchNearbyPlaces(restApiKey, longitude, latitude, category) {
  const url = new URL(KAKAO_CATEGORY_URL);
  url.search = new URLSearchParams({
    category_group_code: category.code,
    x: String(longitude),
    y: String(latitude),
    radius: "5000",
    sort: "distance",
    page: "1",
    size: "5",
  }).toString();

  const payload = await requestJson(url, {
    headers: {
      Authorization: `KakaoAK ${restApiKey}`,
    },
  });
  const documents = asArray(payload.documents);

  return {
    category: category.name,
    receivedCount: documents.length,
    totalCount: Number(payload.meta?.total_count ?? documents.length),
    hasResults: documents.length > 0,
    coordinatesValid: documents.every(
      (place) => Number.isFinite(Number(place.x)) && Number.isFinite(Number(place.y)),
    ),
    distanceValuesValid: documents.every(
      (place) => place.distance !== "" && Number.isFinite(Number(place.distance)),
    ),
    distanceOrderValid: documents.every(
      (place, index) => index === 0 || Number(documents[index - 1].distance) <= Number(place.distance),
    ),
    places: documents.map((place) => ({
      id: place.id,
      name: place.place_name,
      category: place.category_name,
      distanceMeters: Number(place.distance),
      address: place.road_address_name || place.address_name,
      longitude: Number(place.x),
      latitude: Number(place.y),
      url: place.place_url,
    })),
  };
}

function validateDate(value, name) {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`${name}은 YYYYMMDD 형식의 숫자 8자리여야 합니다.`);
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${name}이 실제 달력에 존재하지 않는 날짜입니다.`);
  }

  return date;
}

function validateDateRange(startDate, endDate) {
  const start = validateDate(startDate, "시작일");
  const end = validateDate(endDate, "종료일");

  if (start > end) {
    throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
  }
}

function validateCoordinates(longitude, latitude) {
  const x = Number(longitude);
  const y = Number(latitude);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("경도와 위도는 숫자로 입력하세요.");
  }

  if (x < -180 || x > 180 || y < -90 || y > 90) {
    throw new Error("경도는 -180~180, 위도는 -90~90 범위여야 합니다.");
  }

  return { longitude: x, latitude: y };
}

function summarizeFestival(festival, detail) {
  return {
    id: festival.contentid,
    title: festival.title,
    eventStartDate: festival.eventstartdate,
    eventEndDate: festival.eventenddate,
    address: festival.addr1,
    longitude: Number(festival.mapx),
    latitude: Number(festival.mapy),
    image: festival.firstimage || null,
    detailOverviewReceived: Boolean(detail?.overview),
  };
}

function hasValidFestivalCoordinates(festival) {
  if (
    festival.mapx == null ||
    festival.mapy == null ||
    String(festival.mapx).trim() === "" ||
    String(festival.mapy).trim() === ""
  ) {
    return false;
  }

  const longitude = Number(festival.mapx);
  const latitude = Number(festival.mapy);

  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function formatKakaoTestResult(results, data) {
  const invalidResult = results.find(
    (result) =>
      !result.coordinatesValid || !result.distanceValuesValid || !result.distanceOrderValid,
  );

  if (invalidResult) {
    throw new Error(`${invalidResult.category} 결과의 좌표·거리·정렬 검증에 실패했습니다.`);
  }

  const receivedTotal = results.reduce((sum, result) => sum + result.receivedCount, 0);

  return {
    display: {
      status: receivedTotal > 0 ? "success" : "empty",
      message:
        receivedTotal > 0
          ? "API 연결과 추천 데이터 검증에 성공했습니다."
          : "API 연결에는 성공했지만 이 좌표 주변의 추천 데이터가 없습니다.",
    },
    data,
  };
}

async function runWithButton(button, resultSelector, task) {
  button.disabled = true;
  setResult(resultSelector, "running", "테스트 중입니다...");

  try {
    const result = await task();
    if (result?.display) {
      setResult(resultSelector, result.display.status, result.display.message, result.data);
    } else {
      setResult(resultSelector, "success", "성공했습니다.", result);
    }
  } catch (error) {
    setResult(resultSelector, "error", `실패: ${redactSecrets(error.message)}`);
  } finally {
    button.disabled = false;
  }
}

async function runTourTest() {
  const serviceKey = requireInput("#tour-key", "TourAPI 인증키");
  const startDate = requireInput("#event-start-date", "시작일");
  const endDate = requireInput("#event-end-date", "종료일");
  validateDateRange(startDate, endDate);

  const festivals = await fetchFestivals(serviceKey, startDate, endDate);
  if (!festivals.length) throw new Error("해당 기간의 축제 데이터가 없습니다.");

  const festival = festivals.find(
    (item) => item.contentid && hasValidFestivalCoordinates(item),
  );
  if (!festival) throw new Error("상세 ID와 유효한 좌표를 모두 가진 축제를 찾지 못했습니다.");

  const detail = await fetchFestivalDetail(serviceKey, festival.contentid);
  if (!detail) throw new Error("축제 상세 응답이 비어 있습니다.");

  return {
    totalReceived: festivals.length,
    sample: summarizeFestival(festival, detail),
  };
}

async function runKakaoTest() {
  const restApiKey = requireInput("#kakao-key", "Kakao REST API 키");
  const coordinates = validateCoordinates(
    requireInput("#longitude", "경도"),
    requireInput("#latitude", "위도"),
  );

  const results = await Promise.all(
    PLACE_CATEGORIES.map((category) =>
      fetchNearbyPlaces(restApiKey, coordinates.longitude, coordinates.latitude, category),
    ),
  );

  return formatKakaoTestResult(results, {
    receivedTotal: results.reduce((sum, result) => sum + result.receivedCount, 0),
    categories: results,
  });
}

async function runEndToEndTest() {
  const serviceKey = requireInput("#tour-key", "TourAPI 인증키");
  const restApiKey = requireInput("#kakao-key", "Kakao REST API 키");
  const startDate = requireInput("#event-start-date", "시작일");
  const endDate = requireInput("#event-end-date", "종료일");
  validateDateRange(startDate, endDate);

  const festivals = await fetchFestivals(serviceKey, startDate, endDate);
  const festival = festivals.find(
    (item) => item.contentid && hasValidFestivalCoordinates(item),
  );

  if (!festival) {
    throw new Error("주변 장소 검색에 사용할 좌표가 있는 축제를 찾지 못했습니다.");
  }

  const coordinates = {
    longitude: Number(festival.mapx),
    latitude: Number(festival.mapy),
  };
  const [detail, ...places] = await Promise.all([
    fetchFestivalDetail(serviceKey, festival.contentid),
    ...PLACE_CATEGORIES.map((category) =>
      fetchNearbyPlaces(restApiKey, coordinates.longitude, coordinates.latitude, category),
    ),
  ]);

  if (!detail) throw new Error("축제 상세 응답이 비어 있습니다.");

  const data = {
    festival: summarizeFestival(festival, detail),
    nearby: places.map(
      ({
        category,
        receivedCount,
        totalCount,
        hasResults,
        coordinatesValid,
        distanceValuesValid,
        distanceOrderValid,
        places: categoryPlaces,
      }) => ({
        category,
        receivedCount,
        totalCount,
        hasResults,
        coordinatesValid,
        distanceValuesValid,
        distanceOrderValid,
        nearest: categoryPlaces[0] ?? null,
      }),
    ),
  };

  return formatKakaoTestResult(places, data);
}

async function runSupabaseTest() {
  const projectUrl = requireInput("#supabase-url", "Supabase Project URL");
  const publishableKey = requireInput("#supabase-key", "Supabase publishable key");
  const email = requireInput("#supabase-email", "테스트 계정 이메일");
  const password = requireInput("#supabase-password", "테스트 계정 비밀번호");

  let endpoint;
  try {
    endpoint = new URL("/auth/v1/token?grant_type=password", projectUrl);
  } catch {
    throw new Error("올바른 Supabase Project URL을 입력하세요.");
  }

  if (endpoint.protocol !== "https:") {
    throw new Error("로그인 정보 보호를 위해 HTTPS Supabase URL만 사용할 수 있습니다.");
  }
  if (!endpoint.hostname.endsWith(".supabase.co")) {
    throw new Error("공식 Supabase 프로젝트 주소(*.supabase.co)를 입력하세요.");
  }

  const payload = await requestJson(endpoint, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!payload.user?.id || !payload.access_token) {
    throw new Error("로그인 응답에 필수 사용자 또는 토큰 정보가 없습니다.");
  }
  if (payload.user.email?.toLowerCase() !== email.toLowerCase()) {
    throw new Error("로그인 응답의 이메일이 입력한 계정과 일치하지 않습니다.");
  }

  return {
    loginSucceeded: true,
    accessTokenReceived: Boolean(payload.access_token),
    refreshTokenReceived: Boolean(payload.refresh_token),
    persistedInBrowser: false,
  };
}

$("#tour-test-button").addEventListener("click", (event) => {
  runWithButton(event.currentTarget, "#tour-result", runTourTest);
});

$("#kakao-test-button").addEventListener("click", (event) => {
  runWithButton(event.currentTarget, "#kakao-result", runKakaoTest);
});

$("#flow-test-button").addEventListener("click", (event) => {
  runWithButton(event.currentTarget, "#flow-result", runEndToEndTest);
});

$("#supabase-test-button").addEventListener("click", (event) => {
  runWithButton(event.currentTarget, "#supabase-result", runSupabaseTest);
});
