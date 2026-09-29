import { ReportData, EmailAudienceSettings } from "../types";
import { maskCustomerName } from "./masking";
import { getSafeInvestigationText, resolveItemStatus } from "./investigationStatus";

export const DEFAULT_EMAIL_AUDIENCE_SETTINGS: EmailAudienceSettings = {
  includeVisual: true,          // 현품 외관 성상
  includeInstrumental: false,   // 정밀 기기분석(FTIR/XRF): 내부용 기본 (소비자용은 옵션)
  includeMicroscope: false,     // 확대경/현미경: 내부용 기본 (소비자용은 옵션)
  includePhysicochemical: true, // 이화학 및 살균 시험 요약
  includeProcessDetails: false, // 제조공정 상세(Mesh, 압력 등): 내부용 기본 (공장 보안)
  includeLotHistory: true,      // 동일 Lot 보관품 이상 여부 (안심 근거)
  includeRootCause: true,       // 원인 규명 결과
  includePreventive: true,      // 재발방지 개선 대책
  includeUncertainty: false,    // 조사 한계 및 불확실성: 내부용 전용
  useSimplifiedTerms: true,     // 소비자용 쉬운 용어 변환
  strictSafetyGuard: true,      // 안전성/무해 단정 표현 엄격 차단
};

/**
 * 소비자용 쉬운 용어 변환 딕셔너리
 */
const TECHNICAL_TERMS_MAP: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /FT-IR\s*(적외선\s*분광\s*분석)?/gi, replacement: "정밀 적외선 성분 분석" },
  { regex: /XRF\s*(X선\s*형광\s*분석)?/gi, replacement: "정밀 무기물 원소 분석" },
  { regex: /EPDM/gi, replacement: "제조 설비용 식품용 고무 패킹 부품" },
  { regex: /카탈라아제\s*(효소\s*활성\s*시험)?/gi, replacement: "가열 살균 확인 시험" },
  { regex: /COA/gi, replacement: "완제품 공인 품질검사 성적서" },
  { regex: /150\s*Mesh\s*\(105[uμ]m\)/gi, replacement: "0.1mm 정밀 여과 필터망" },
  { regex: /Mesh|mesh/gi, replacement: "정밀 여과망" },
  { regex: /파단면/gi, replacement: "마찰 및 접촉 흔적" },
  { regex: /관능\s*검사/gi, replacement: "맛과 향, 색상 등 완제품 품질 검사" },
  { regex: /보관\s*검체|자사\s*보관품/gi, replacement: "동일 날짜 생산 당사 공장 보관 제품" },
  { regex: /린싱\(Rinsing\)|린싱/gi, replacement: "고온 온수 세척" },
  { regex: /에어\s*블로우/gi, replacement: "청정 공기 분사 세척" },
  { regex: /배양\s*검사/gi, replacement: "미생물 안전 정밀 검사" },
];

/**
 * 전문 기술 용어를 소비자가 알기 쉬운 표현으로 변환
 */
export function simplifyTechnicalTerms(text: string): string {
  if (!text) return "";
  let simplified = text;
  for (const { regex, replacement } of TECHNICAL_TERMS_MAP) {
    simplified = simplified.replace(regex, replacement);
  }
  return simplified;
}

/**
 * 근거 없는 "무해/안전" 단정 표현 패턴 목록
 */
const UNGROUNDED_SAFETY_PATTERNS: Array<{ regex: RegExp; safeAlternative: string; label: string }> = [
  {
    regex: /(인체에|건강에)\s*(전혀|완전히|절대)?\s*(무해합|무해함|해가\s*없|영향이\s*없)/g,
    safeAlternative: "식품 안전 관리 규격 기준에 적합하게 관리됨",
    label: "인체 무해 단정 표현",
  },
  {
    regex: /100%\s*안전|절대\s*안전|완전\s*안전/g,
    safeAlternative: "규격 기준치에 적합하여 이상 소견 없음",
    label: "절대 안전 과장 표현",
  },
  {
    regex: /안심하고\s*(섭취|음용|복용)하셔도\s*됩니다/g,
    safeAlternative: "해당 제품군 규격에 적합함을 확인하였습니다",
    label: "음용 권유 단정 표현",
  },
  {
    regex: /전혀\s*문제가\s*없/g,
    safeAlternative: "검사 항목 전반에서 기준 적합으로 확인되었음",
    label: "단정적 무결성 표현",
  },
];

/**
 * 근거 없는 안전 표현 엄격 차단 및 대체
 */
export function sanitizeSafetyClaims(
  text: string,
  hasScientificEvidence: boolean
): { sanitized: string; violationsFound: string[] } {
  if (!text) return { sanitized: "", violationsFound: [] };

  let sanitized = text;
  const violationsFound: string[] = [];

  for (const pattern of UNGROUNDED_SAFETY_PATTERNS) {
    if (pattern.regex.test(sanitized)) {
      violationsFound.push(pattern.label);
      // 과학적 검증 데이터가 확실한 경우에도 단정적 표현은 법적 리스크가 있으므로 규격 적합성 사실 표현으로 정제
      const replacement = hasScientificEvidence
        ? pattern.safeAlternative
        : "현재까지 확인된 시험 항목 기준 적합 (추가 규격 준수 관리)";
      sanitized = sanitized.replace(pattern.regex, replacement);
    }
  }

  return { sanitized, violationsFound };
}

/**
 * 보고서 데이터로부터 내부용 / 소비자용 포맷 생성 결과 인터페이스
 */
export interface GeneratedEmailResult {
  internal: {
    plainText: string;
    htmlText: string;
    subject: string;
    summaryCount: {
      technicalItems: number;
      processItems: number;
      uncertaintyIncluded: boolean;
    };
  };
  consumer: {
    plainText: string;
    htmlText: string;
    subject: string;
    violationsBlocked: string[];
    simplifiedTermsApplied: boolean;
    omittedInternalItems: string[];
  };
}

/**
 * 연구원 명칭 클린징
 */
function cleanResearcherName(name?: string): string {
  if (!name || name.includes("박병철") || name.includes("커뮤니케이션")) {
    return "담당 연구원 김진영 대리";
  }
  return name.startsWith("담당") ? name : `담당 연구원 ${name}`;
}

/**
 * 내부용 및 소비자용 문서 동시 생성
 */
export function formatAudienceEmails(
  report: ReportData,
  customSettings?: Partial<EmailAudienceSettings>
): GeneratedEmailResult {
  const settings: EmailAudienceSettings = {
    ...DEFAULT_EMAIL_AUDIENCE_SETTINGS,
    ...(report.emailAudienceSettings || {}),
    ...(customSettings || {}),
  };

  const {
    customerClaim,
    productInfo,
    analysisResults,
    manufacturingProcess,
    lotHistory,
    rootCauseAndActions,
    conclusion,
    companyName = "광동제약주식회사",
    companyTel = "전화(031)8093-1813",
  } = report;

  const researcher = cleanResearcherName(report.researcherName);
  const displayName = maskCustomerName(
    customerClaim.customerName || "고객",
    customerClaim.maskCustomerName
  );
  const receivedDate = customerClaim.receivedAt
    ? customerClaim.receivedAt.split("T")[0]
    : new Date().toISOString().split("T")[0];

  // 안전성 근거 판정
  const isMicrobialTested =
    !analysisResults.physicochemicalAnalysis.skipped &&
    analysisResults.physicochemicalAnalysis.items.some(
      (i) =>
        i.name.includes("대장균") ||
        i.name.includes("미생물") ||
        i.name.includes("세균") ||
        i.name.includes("독소")
    );
  const retainedSafe =
    lotHistory.retainedSampleStatus === "이상 없음" ||
    lotHistory.retainedSampleStatus === "확인 완료";
  const hasScientificEvidence = isMicrobialTested || retainedSafe;

  const visualInfo = getSafeInvestigationText(
    analysisResults.visualInspection.status,
    analysisResults.visualInspection.sampleCondition,
    { skipped: analysisResults.visualInspection.skipped, investigatedFallback: "특이사항 없음" }
  );

  const retainedInfo = getSafeInvestigationText(
    lotHistory.retainedSampleStatus,
    lotHistory.retainedSampleCheck,
    { skipped: lotHistory.skipped, investigatedFallback: "동일 Lot 공장 보관 검체 이상 없음" }
  );

  const rootCauseRaw = rootCauseAndActions.rootCause?.trim() || "";
  const rootCauseStatus = resolveItemStatus(
    rootCauseAndActions.status,
    rootCauseAndActions.skipped,
    rootCauseRaw
  );
  const isRootCauseKnown =
    Boolean(rootCauseRaw) && rootCauseStatus !== "미실시" && rootCauseStatus !== "확인 불가";

  // =========================================================================
  // 1. [내부용 이메일] - 기술적 정밀 분석, 공정 이력, 불확실성 포함
  // =========================================================================
  const internalSubject = `[조사결과 회신] ${productInfo.productName || "제품"} 클레임 원인조사 완료 및 고객 응대 가이드 (${displayName} 건)`;

  let internalTechnicalCount = 0;
  let internalProcessCount = 0;

  // Plain Text
  let internalPlain = `수신: 커뮤니케이션팀 (고객소통 / CS 상담 담당자 앞)\n`;
  internalPlain += `발신: ${companyName} 식품품질경영팀 (${researcher})\n`;
  internalPlain += `제목: ${internalSubject}\n\n`;
  internalPlain += `커뮤니케이션팀 담당자님, 안녕하십니까.\n`;
  internalPlain += `${companyName} 식품품질경영팀 ${researcher}입니다.\n\n`;
  internalPlain += `접수 의뢰해 주신 [${productInfo.productName || "당사 제품"}] 건에 대하여 동일 Lot 제조 이력 점검 및 정밀 시험 분석을 완료하여 기술적 조사 결과를 회신드립니다.\n`;
  internalPlain += `식품품질경영팀장이 최종 승인한 정식 원인조사 결과 보고서(공문서 PDF)를 첨부하오니, 고객 응대(유선/서면) 시 아래의 핵심 조사 요약 및 [고객 소통 가이드]를 참고하여 주시기 바랍니다.\n\n`;

  internalPlain += `--------------------------------------------------\n`;
  internalPlain += `1. 클레임 인입 개요\n`;
  internalPlain += `• 고객명: ${displayName} (접수일: ${receivedDate})\n`;
  internalPlain += `• 인입 채널: ${customerClaim.channel || "커뮤니케이션팀 접수"}\n`;
  internalPlain += `• 대상 제품: ${productInfo.productName || "-"}\n`;
  internalPlain += `• 유통기한 / Lot: ${productInfo.expiryDate || "-"} / ${productInfo.lotNumber || "-"}\n`;
  internalPlain += `• 고객 인입 증상: ${customerClaim.claimDetails || "이상 현상 확인 의뢰"}\n\n`;

  internalPlain += `2. 정밀 시험 및 기기 분석 데이터 (기술적 조사 근거)\n`;
  if (!analysisResults.visualInspection.skipped) {
    internalPlain += `• 현품 성상 및 육안: [${visualInfo.status}] ${visualInfo.displayText}\n`;
    if (analysisResults.visualInspection.foreignObjectAppearance) {
      internalPlain += `• 이물 외형 관찰: ${analysisResults.visualInspection.foreignObjectAppearance}\n`;
    }
    internalTechnicalCount++;
  }
  if (!analysisResults.magnifierInspection.skipped && analysisResults.magnifierInspection.result) {
    internalPlain += `• 확대경 조사 (${analysisResults.magnifierInspection.magnification || "배율미상"}): ${analysisResults.magnifierInspection.result}\n`;
    internalTechnicalCount++;
  }
  if (!analysisResults.opticalMicroscope.skipped && analysisResults.opticalMicroscope.result) {
    internalPlain += `• 광학현미경 조사 (${analysisResults.opticalMicroscope.magnification || "고배율"}): ${analysisResults.opticalMicroscope.result}\n`;
    internalTechnicalCount++;
  }
  if (!analysisResults.ftirAnalysis.skipped && (analysisResults.ftirAnalysis.matchedMaterial || analysisResults.ftirAnalysis.summary)) {
    internalPlain += `• FT-IR 적외선 분광: 매칭물질 [${analysisResults.ftirAnalysis.matchedMaterial || "-"}], 일치율 [${analysisResults.ftirAnalysis.similarity || "-"}%], 요약 [${analysisResults.ftirAnalysis.summary || "-"}]\n`;
    internalTechnicalCount++;
  }
  if (!analysisResults.xrfAnalysis.skipped && (analysisResults.xrfAnalysis.elementsRatio || analysisResults.xrfAnalysis.summary)) {
    internalPlain += `• XRF X선 형광분석: 원소비율 [${analysisResults.xrfAnalysis.elementsRatio || "-"}], 판정 [${analysisResults.xrfAnalysis.summary || "-"}]\n`;
    internalTechnicalCount++;
  }
  if (!analysisResults.physicochemicalAnalysis.skipped && analysisResults.physicochemicalAnalysis.items.length > 0) {
    const pItems = analysisResults.physicochemicalAnalysis.items
      .map((i) => `${i.name}: ${i.sampleValue || "-"} (기준 ${i.standard || "-"}, ${i.judgment})`)
      .join(", ");
    internalPlain += `• 이화학 시험: [${analysisResults.physicochemicalAnalysis.status || "확인 완료"}] ${pItems}\n`;
    internalTechnicalCount++;
  }
  if (!analysisResults.catalaseTest.skipped && analysisResults.catalaseTest.resultJudgement) {
    internalPlain += `• 카탈라아제 효소활성: ${analysisResults.catalaseTest.resultJudgement} (반응: ${analysisResults.catalaseTest.reactionDetail || "기록 없음"})\n`;
    internalTechnicalCount++;
  }

  internalPlain += `\n3. 공정 관리 및 동일 Lot 이력 점검\n`;
  if (!manufacturingProcess.skipped) {
    if (manufacturingProcess.filtrationAnalysis) {
      internalPlain += `• 여과망 관리: ${manufacturingProcess.filtrationAnalysis}\n`;
      internalProcessCount++;
    }
    if (manufacturingProcess.cleaningAnalysis) {
      internalPlain += `• 세척 공정: ${manufacturingProcess.cleaningAnalysis}\n`;
      internalProcessCount++;
    }
    if (manufacturingProcess.criticalControlPoint) {
      internalPlain += `• CCP 유력 지점 분석: ${manufacturingProcess.criticalControlPoint}\n`;
      internalProcessCount++;
    }
  }
  if (!lotHistory.skipped) {
    internalPlain += `• 공장 보관 검체: [${retainedInfo.status}] ${retainedInfo.displayText}\n`;
    if (lotHistory.productionLogNote) {
      internalPlain += `• 제조 당일 생산일지: [${lotHistory.productionLogStatus || "확인"}] ${lotHistory.productionLogNote}\n`;
    }
    if (lotHistory.priorClaimsCount) {
      internalPlain += `• 동일 Lot 이전 접수 이력: ${lotHistory.priorClaimsCount}\n`;
    }
    internalProcessCount++;
  }

  internalPlain += `\n4. 종합 원인 판정 및 재발방지대책\n`;
  internalPlain += `• 원인 판정: ${isRootCauseKnown ? rootCauseRaw : "원인 규명 진행 중 (단정 설명 금지)"}\n`;
  if (!rootCauseAndActions.preventiveMeasuresSkipped && rootCauseAndActions.preventiveMeasures) {
    internalPlain += `• 재발방지대책: ${rootCauseAndActions.preventiveMeasures}\n`;
  }

  // 내부용 전용: 불확실성 및 한계점
  internalPlain += `\n5. ⚠️ [품질경영팀 내부 검토용 불확실성 & 조사 한계점]\n`;
  internalPlain += `• 시료 한계: 고객 개봉 후 잔류량에 따른 시험 제한성 및 외기 노출 가능성이 존재함.\n`;
  if (!isRootCauseKnown) {
    internalPlain += `• 원인 규명 한계: 물리적 유입 경로에 대한 결정적 증거가 불충분하므로 고객 유선 설명 시 특정 원인 단정 절대 엄금.\n`;
  } else {
    internalPlain += `• 관리 권고: 추정 원인(${rootCauseRaw})의 재발 방지를 위한 정비 주기 점검 및 모니터링 강화 필요.\n`;
  }

  // 고객 소통 가이드
  internalPlain += `\n6. 📢 [커뮤니케이션팀 고객 소통 가이드 (상담 스크립트 포인트)]\n`;
  if (hasScientificEvidence) {
    internalPlain += `• [안전성 설명]: 당사 공장 보관 검체 및 이화학 시험 결과 규격 적합으로 확인된 사실만을 객관적으로 전달하십시오.\n`;
  } else {
    internalPlain += `• [주의: 무해성 단정 금지]: 인체 위해성 관련 정밀 시험이 미실시되었으므로 "인체에 무해하다" 또는 "안전하다"고 단정하여 설명하지 마십시오.\n`;
  }
  if (isRootCauseKnown) {
    internalPlain += `• [원인 설명]: 조사 결과 확인된 원인을 기술 전문 용어가 아닌 알기 쉬운 말로 완곡하게 설명하십시오.\n`;
  } else {
    internalPlain += `• [주의: 원인 단정 금지]: 명확한 원인이 규명되지 않았으므로 임의로 "소비자 부주의"나 "외적 요인"으로 단정 짓지 마십시오.\n`;
  }
  internalPlain += `• [공식 보고서 첨부]: 식품품질경영팀장 승인 [원인조사 보고서(공문서 PDF)]가 첨부되어 있음을 안내하십시오.\n\n`;

  internalPlain += `7. 첨부 파일\n`;
  internalPlain += `• [첨부] ${productInfo.productName || "제품"}_원인조사보고서(식품품질경영팀).pdf\n\n`;
  internalPlain += `--------------------------------------------------\n`;
  internalPlain += `${companyName} 식품품질경영팀\n`;
  internalPlain += `${researcher} (내선/문의: ${companyTel})\n`;

  // HTML Text
  let internalHtml = `<div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; font-size: 13px; line-height: 1.6; color: #334155; max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 22px;">`;
  internalHtml += `<div style="background-color: #0f172a; color: #ffffff; padding: 14px 18px; border-radius: 6px; margin-bottom: 18px;">`;
  internalHtml += `<div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: bold; margin-bottom: 2px;">[내부용 / 커뮤니케이션팀 회신용]</div>`;
  internalHtml += `<div style="font-size: 15px; font-weight: bold; color: #ffffff;">${internalSubject}</div>`;
  internalHtml += `</div>`;

  internalHtml += `<table style="width: 100%; font-size: 12px; margin-bottom: 18px; border-collapse: collapse; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">`;
  internalHtml += `<tr><td style="padding: 6px 12px; width: 90px; font-weight: bold; color: #64748b; border-bottom: 1px solid #e2e8f0;">수 &nbsp; 신</td><td style="padding: 6px 12px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0;">커뮤니케이션팀 (고객소통 / CS 상담 담당자 앞)</td></tr>`;
  internalHtml += `<tr><td style="padding: 6px 12px; font-weight: bold; color: #64748b; border-bottom: 1px solid #e2e8f0;">발 &nbsp; 신</td><td style="padding: 6px 12px; color: #0f172a; border-bottom: 1px solid #e2e8f0;"><strong>${companyName} 식품품질경영팀</strong> (${researcher})</td></tr>`;
  internalHtml += `<tr><td style="padding: 6px 12px; font-weight: bold; color: #64748b;">인입 고객</td><td style="padding: 6px 12px; color: #334155;"><strong>${displayName}</strong> 고객님 (접수일: ${receivedDate}, 채널: ${customerClaim.channel || "접수"})</td></tr>`;
  internalHtml += `</table>`;

  internalHtml += `<p style="margin: 0 0 14px 0; font-size: 13px; color: #1e293b;">`;
  internalHtml += `커뮤니케이션팀 담당자님, 안녕하십니까.<br/>`;
  internalHtml += `<strong>${companyName} 식품품질경영팀 ${researcher}</strong>입니다.<br/>`;
  internalHtml += `접수 의뢰 건에 대해 동일 Lot 제조 이력 점검 및 정밀 시험 분석을 완료하여 기술적 조사 결과를 회신합니다. 아래의 데이터와 [고객 소통 가이드]를 참고하여 고객 상담을 진행해 주시기 바랍니다.`;
  internalHtml += `</p>`;

  // 1. Target Product
  internalHtml += `<div style="background: #f1f5f9; padding: 8px 12px; border-radius: 6px; margin-bottom: 14px; font-size: 12px;">`;
  internalHtml += `<strong>[대상 제품]</strong> ${productInfo.productName || "-"} &nbsp;|&nbsp; <strong>[유통기한/Lot]</strong> ${productInfo.expiryDate || "-"} / ${productInfo.lotNumber || "-"}`;
  internalHtml += `</div>`;

  // 2. Technical Evidence
  internalHtml += `<div style="margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; background: #ffffff;">`;
  internalHtml += `<h4 style="margin: 0 0 8px 0; font-size: 13px; color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 4px;">1. 정밀 시험 & 기기 분석 데이터 (기술적 조사 근거)</h4>`;
  internalHtml += `<ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #334155; line-height: 1.7;">`;
  if (!analysisResults.visualInspection.skipped) {
    internalHtml += `<li><strong>현품 성상:</strong> [${visualInfo.status}] ${visualInfo.displayText}</li>`;
  }
  if (!analysisResults.ftirAnalysis.skipped && (analysisResults.ftirAnalysis.matchedMaterial || analysisResults.ftirAnalysis.summary)) {
    internalHtml += `<li><strong>FT-IR 적외선 분광:</strong> 매칭물질 [${analysisResults.ftirAnalysis.matchedMaterial || "-"}], 일치율 [${analysisResults.ftirAnalysis.similarity || "-"}%]</li>`;
  }
  if (!analysisResults.physicochemicalAnalysis.skipped && analysisResults.physicochemicalAnalysis.items.length > 0) {
    const pStr = analysisResults.physicochemicalAnalysis.items
      .map((i) => `<strong>${i.name}</strong>: ${i.sampleValue || "-"} (${i.judgment})`)
      .join(" / ");
    internalHtml += `<li><strong>이화학 시험:</strong> ${pStr}</li>`;
  }
  internalHtml += `<li><strong>공장 보관 검체:</strong> [${retainedInfo.status}] ${retainedInfo.displayText}</li>`;
  internalHtml += `<li><strong>종합 원인 판정:</strong> <strong>${isRootCauseKnown ? rootCauseRaw : '<span style="color:#b45309;">원인 규명 진행 중</span>'}</strong></li>`;
  internalHtml += `</ul>`;
  internalHtml += `</div>`;

  // 3. Uncertainty Box (Internal Only)
  internalHtml += `<div style="margin-bottom: 14px; border: 1px solid #fcd34d; border-radius: 6px; padding: 12px; background: #fffbeb;">`;
  internalHtml += `<h4 style="margin: 0 0 6px 0; font-size: 12px; color: #b45309; font-weight: bold;">⚠️ [내부 전용] 조사 한계점 및 불확실성 (고객 대외비)</h4>`;
  internalHtml += `<p style="margin: 0; font-size: 11px; line-height: 1.6; color: #92400e;">`;
  internalHtml += `• 잔류 시료 검체량의 한계 및 개봉 후 경과 시간으로 인해 외기 혼입 여부의 100% 특정에는 한계가 존재함.<br/>`;
  internalHtml += `• 따라서 고객 상담 시 제조 공정 결함 또는 외부 요인을 일방적으로 단정 짓지 말고 완곡히 사실 중심으로 설명 요망.`;
  internalHtml += `</p>`;
  internalHtml += `</div>`;

  // 4. Communication Guide Box
  internalHtml += `<div style="margin-bottom: 16px; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px; background: #eff6ff;">`;
  internalHtml += `<h4 style="margin: 0 0 6px 0; font-size: 13px; color: #1d4ed8; font-weight: bold;">📢 커뮤니케이션팀 고객 소통 가이드 (상담 스크립트 포인트)</h4>`;
  internalHtml += `<ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #1e40af; line-height: 1.6;">`;
  if (hasScientificEvidence) {
    internalHtml += `<li><strong>안전성 안내:</strong> 공장 보관 검체 및 이화학 성분 검사 적합 사실을 객관적으로 안내.</li>`;
  } else {
    internalHtml += `<li><strong>[주의] 무해성 단정 금지:</strong> 정밀 안전성 시험이 미실시되었으므로 "인체에 무해하다"는 단정적 표현 엄금.</li>`;
  }
  if (isRootCauseKnown) {
    internalHtml += `<li><strong>원인 설명:</strong> 확인된 원인(${rootCauseRaw})을 고객 눈높이에 맞추어 친절히 설명.</li>`;
  } else {
    internalHtml += `<li><strong>[주의] 원인 단정 금지:</strong> 원인이 미확정되었으므로 임의로 외부 요인으로 단정 지어 설명 금지.</li>`;
  }
  internalHtml += `<li><strong>공문서 보고서 전달:</strong> 식품품질경영팀 공문서 PDF 보고서가 첨부되었음을 전달.</li>`;
  internalHtml += `</ul>`;
  internalHtml += `</div>`;

  // Attachments & Signature
  internalHtml += `<div style="background: #f8fafc; padding: 8px 12px; border: 1px dashed #cbd5e1; border-radius: 6px; font-size: 12px; color: #475569; margin-bottom: 16px;">`;
  internalHtml += `📎 <strong>첨부파일:</strong> ${productInfo.productName || "제품"}_원인조사보고서(식품품질경영팀).pdf`;
  internalHtml += `</div>`;
  internalHtml += `<div style="border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 12px; color: #64748b;">`;
  internalHtml += `<strong>${companyName} 식품품질경영팀</strong> &nbsp;|&nbsp; ${researcher} (문의: ${companyTel})`;
  internalHtml += `</div>`;
  internalHtml += `</div>`;

  // =========================================================================
  // 2. [소비자용 안내문] - 쉬운 표현, 불필요한 내부정보 제외, 안전표현 금지 준수
  // =========================================================================
  const consumerSubject = `[안내] ${productInfo.productName || "제품"} 관련 문의에 대한 식품품질경영팀 원인조사 결과 안내의 건`;

  const omittedInternalItems: string[] = [];
  const violationsBlocked: string[] = [];

  // 소비자 텍스트 작성
  let consumerPlain = `수신: ${displayName} 고객님\n`;
  consumerPlain += `발신: ${companyName} 식품품질경영팀\n`;
  consumerPlain += `제목: ${consumerSubject}\n\n`;
  consumerPlain += `안녕하십니까, ${displayName} 고객님.\n`;
  consumerPlain += `${companyName} 식품품질경영팀입니다.\n\n`;
  consumerPlain += `항상 저희 제품을 애용해 주셔서 진심으로 감사드립니다.\n`;
  consumerPlain += `고객님께서 문의해 주신 [${productInfo.productName || "당사 제품"}] 건과 관련하여 식품품질경영팀에서 제조 이력 점검 및 정밀 분석을 실시하였으며, 식품품질경영팀장이 최종 승인한 조사 결과를 아래와 같이 정중히 안내해 드립니다.\n\n`;

  consumerPlain += `--------------------------------------------------\n`;
  consumerPlain += `[대상 제품 정보]\n`;
  consumerPlain += `• 제품명: ${productInfo.productName || "-"}\n`;
  consumerPlain += `• 유통기한 / 제조번호: ${productInfo.expiryDate || "-"} / ${productInfo.lotNumber || "-"}\n\n`;

  consumerPlain += `[원인조사 핵심 요약]\n`;
  let sectionIndex = 1;

  // 1) 현품 성상 (includeVisual)
  if (settings.includeVisual && !analysisResults.visualInspection.skipped) {
    let rawVisual = visualInfo.displayText;
    if (settings.useSimplifiedTerms) rawVisual = simplifyTechnicalTerms(rawVisual);
    consumerPlain += `${sectionIndex++}. 현품 성상 및 관찰: ${rawVisual}\n`;
    if (analysisResults.visualInspection.foreignObjectAppearance) {
      let rawObj = analysisResults.visualInspection.foreignObjectAppearance;
      if (settings.useSimplifiedTerms) rawObj = simplifyTechnicalTerms(rawObj);
      consumerPlain += `   - 관찰 내용: ${rawObj}\n`;
    }
  } else if (!settings.includeVisual) {
    omittedInternalItems.push("현품 육안 및 성상 상세 (내부용에만 포함)");
  }

  // 2) 정밀 기기분석 (includeInstrumental)
  if (settings.includeInstrumental) {
    if (!analysisResults.ftirAnalysis.skipped && analysisResults.ftirAnalysis.matchedMaterial) {
      let ftirText = `정밀 재질 분석 결과 [${analysisResults.ftirAnalysis.matchedMaterial}] 성분으로 확인되었습니다.`;
      if (settings.useSimplifiedTerms) ftirText = simplifyTechnicalTerms(ftirText);
      consumerPlain += `${sectionIndex++}. 성분 정밀 분석: ${ftirText}\n`;
    }
  } else {
    omittedInternalItems.push("FT-IR/XRF 정밀 기기 분석 스펙트럼 (내부용에만 포함)");
  }

  // 3) 현미경/확대경 조사 (includeMicroscope)
  if (settings.includeMicroscope) {
    if (!analysisResults.opticalMicroscope.skipped && analysisResults.opticalMicroscope.result) {
      let micText = analysisResults.opticalMicroscope.result;
      if (settings.useSimplifiedTerms) micText = simplifyTechnicalTerms(micText);
      consumerPlain += `${sectionIndex++}. 미세 구조 관찰: ${micText}\n`;
    }
  } else {
    omittedInternalItems.push("현미경/확대경 미세 배율 관찰 (내부용에만 포함)");
  }

  // 4) 이화학 및 규격 검사 (includePhysicochemical)
  if (settings.includePhysicochemical && !analysisResults.physicochemicalAnalysis.skipped) {
    if (analysisResults.physicochemicalAnalysis.items.length > 0) {
      const allPassed = analysisResults.physicochemicalAnalysis.items.every((i) => i.judgment === "적합");
      const passText = allPassed
        ? "주요 이화학 및 품질 규격 검사 항목 전반에서 공인 기준에 적합함이 확인되었습니다."
        : "품질 규격 검사를 진행하여 기준치를 확인하였습니다.";
      consumerPlain += `${sectionIndex++}. 품질 규격 검사: ${passText}\n`;
    }
  } else if (!settings.includePhysicochemical) {
    omittedInternalItems.push("이화학 시험 수치 세부 성적 (내부용에만 포함)");
  }

  // 5) 공장 보관 검체 (includeLotHistory)
  if (settings.includeLotHistory && !lotHistory.skipped) {
    let rawRetained = retainedInfo.displayText;
    if (settings.useSimplifiedTerms) rawRetained = simplifyTechnicalTerms(rawRetained);
    consumerPlain += `${sectionIndex++}. 동일 날짜 생산 당사 보관 제품 점검: ${rawRetained}\n`;
  } else if (!settings.includeLotHistory) {
    omittedInternalItems.push("동일 Lot 생산일지 및 보관품 상세 (내부용에만 포함)");
  }

  // 6) 제조 공정 상세 (includeProcessDetails)
  if (settings.includeProcessDetails && !manufacturingProcess.skipped) {
    let rawProc = manufacturingProcess.criticalControlPoint || manufacturingProcess.filtrationAnalysis || "";
    if (settings.useSimplifiedTerms) rawProc = simplifyTechnicalTerms(rawProc);
    if (rawProc) {
      consumerPlain += `${sectionIndex++}. 제조 공정 점검: ${rawProc}\n`;
    }
  } else {
    omittedInternalItems.push("공장 제조공정 여과망 규격 및 세척 파라미터 (내부 보안 정보 제외)");
  }

  // 7) 종합 원인 판정 (includeRootCause)
  if (settings.includeRootCause && isRootCauseKnown) {
    let rawCause = rootCauseRaw;
    if (settings.useSimplifiedTerms) rawCause = simplifyTechnicalTerms(rawCause);
    consumerPlain += `${sectionIndex++}. 원인 조사 결과: ${rawCause}\n`;
  } else if (!settings.includeRootCause) {
    omittedInternalItems.push("원인 규명 기술 소견 (내부용에만 포함)");
  }

  // 8) 재발방지 및 개선 대책 (includePreventive)
  if (settings.includePreventive && !rootCauseAndActions.preventiveMeasuresSkipped && rootCauseAndActions.preventiveMeasures) {
    let rawPrev = rootCauseAndActions.preventiveMeasures;
    if (settings.useSimplifiedTerms) rawPrev = simplifyTechnicalTerms(rawPrev);
    consumerPlain += `${sectionIndex++}. 품질 개선 조치: ${rawPrev}\n`;
  }

  // 9) 고객 사과 및 안심 맺음말
  consumerPlain += `\n[고객 안내 및 맺음말]\n`;
  let rawApology =
    conclusion.apologyText ||
    "저희 제품으로 인해 불편을 겪으신 고객님께 진심으로 사과의 말씀을 드리며, 철저한 품질 관리로 보답하겠습니다.";
  if (settings.useSimplifiedTerms) rawApology = simplifyTechnicalTerms(rawApology);

  // 안전성 표현 엄격 가드 적용
  if (settings.strictSafetyGuard) {
    const { sanitized, violationsFound } = sanitizeSafetyClaims(rawApology, hasScientificEvidence);
    rawApology = sanitized;
    violationsBlocked.push(...violationsFound);
  }
  consumerPlain += `${rawApology}\n\n`;

  consumerPlain += `* 상세한 조사 내용과 공식 확인 결과는 첨부된 [원인조사 결과 보고서(공문서 PDF)]를 확인해 주시기 바랍니다.\n\n`;
  consumerPlain += `감사합니다.\n\n`;
  consumerPlain += `--------------------------------------------------\n`;
  consumerPlain += `${companyName} 식품품질경영팀\n`;
  consumerPlain += `${researcher} (문의 전화: ${companyTel})\n`;

  // HTML 버전 작성 (소비자 친화적 디자인)
  let consumerHtml = `<div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; font-size: 14px; line-height: 1.65; color: #1e293b; max-width: 650px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">`;
  consumerHtml += `<div style="background-color: #f8fafc; border-left: 4px solid #dc2626; padding: 12px 16px; margin-bottom: 20px;">`;
  consumerHtml += `<p style="margin: 0; font-size: 12px; color: #64748b;"><strong>수신:</strong> ${displayName} 고객님</p>`;
  consumerHtml += `<p style="margin: 4px 0 0 0; font-size: 15px; font-weight: bold; color: #0f172a;">${consumerSubject}</p>`;
  consumerHtml += `</div>`;

  consumerHtml += `<p style="margin: 0 0 12px 0;">안녕하십니까, <strong>${displayName}</strong> 고객님.<br/><strong>${companyName} 식품품질경영팀</strong>입니다.</p>`;
  consumerHtml += `<p style="margin: 0 0 16px 0; color: #475569;">항상 저희 제품을 애용해 주셔서 진심으로 감사드립니다.<br/>고객님께서 문의해 주신 <strong>[${productInfo.productName || "당사 제품"}]</strong>에 대해 제조 이력 및 보관품 정밀 조사를 신속히 실시하였으며, 식품품질경영팀장이 최종 승인한 조사 결과를 정중히 안내해 드립니다.</p>`;

  consumerHtml += `<div style="background: #f1f5f9; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">`;
  consumerHtml += `<strong>[대상 제품 정보]</strong> 제품명: <strong>${productInfo.productName || "-"}</strong> &nbsp;|&nbsp; 유통기한: ${productInfo.expiryDate || "-"} &nbsp;|&nbsp; 제조번호: ${productInfo.lotNumber || "-"}`;
  consumerHtml += `</div>`;

  consumerHtml += `<h4 style="margin: 20px 0 10px 0; font-size: 14px; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px;">[원인조사 핵심 요약]</h4>`;
  consumerHtml += `<ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.8;">`;

  if (settings.includeVisual && !analysisResults.visualInspection.skipped) {
    let vText = visualInfo.displayText;
    if (settings.useSimplifiedTerms) vText = simplifyTechnicalTerms(vText);
    consumerHtml += `<li><strong>현품 성상 및 관찰:</strong> ${vText}</li>`;
  }
  if (settings.includeInstrumental && !analysisResults.ftirAnalysis.skipped && analysisResults.ftirAnalysis.matchedMaterial) {
    consumerHtml += `<li><strong>정밀 재질 분석:</strong> [${simplifyTechnicalTerms(analysisResults.ftirAnalysis.matchedMaterial)}] 성분 확인</li>`;
  }
  if (settings.includePhysicochemical && !analysisResults.physicochemicalAnalysis.skipped) {
    consumerHtml += `<li><strong>품질 규격 검사:</strong> 공인 시험 기준치 전반 적합 확인</li>`;
  }
  if (settings.includeLotHistory && !lotHistory.skipped) {
    let rText = retainedInfo.displayText;
    if (settings.useSimplifiedTerms) rText = simplifyTechnicalTerms(rText);
    consumerHtml += `<li><strong>동일 날짜 생산 당사 보관 제품:</strong> ${rText}</li>`;
  }
  if (settings.includeRootCause && isRootCauseKnown) {
    let cText = rootCauseRaw;
    if (settings.useSimplifiedTerms) cText = simplifyTechnicalTerms(cText);
    consumerHtml += `<li><strong>원인 판정:</strong> <strong>${cText}</strong></li>`;
  }
  consumerHtml += `</ul>`;

  // 사과문 및 안심 안내 박스
  consumerHtml += `<div style="margin-top: 20px; font-size: 13px; line-height: 1.7; color: #1e293b; background-color: #f8fafc; padding: 14px; border-radius: 6px; border: 1px solid #e2e8f0;">`;
  consumerHtml += rawApology.replace(/\n/g, "<br/>");
  consumerHtml += `</div>`;

  consumerHtml += `<p style="font-size: 12px; color: #64748b; margin-top: 16px;">* 상세한 검증 데이터와 공문서 양식 보고서는 첨부된 PDF 파일을 확인해 주시기 바랍니다.</p>`;

  consumerHtml += `<div style="margin-top: 24px; padding-top: 14px; border-top: 2px solid #e2e8f0; font-size: 13px; color: #64748b;">`;
  consumerHtml += `<p style="margin: 0; font-weight: bold; font-size: 14px; color: #0f172a;">${companyName} 식품품질경영팀</p>`;
  consumerHtml += `<p style="margin: 4px 0 0 0;">${researcher} (문의: ${companyTel})</p>`;
  consumerHtml += `</div>`;
  consumerHtml += `</div>`;

  return {
    internal: {
      plainText: internalPlain,
      htmlText: internalHtml,
      subject: internalSubject,
      summaryCount: {
        technicalItems: internalTechnicalCount,
        processItems: internalProcessCount,
        uncertaintyIncluded: true,
      },
    },
    consumer: {
      plainText: consumerPlain,
      htmlText: consumerHtml,
      subject: consumerSubject,
      violationsBlocked: Array.from(new Set(violationsBlocked)),
      simplifiedTermsApplied: settings.useSimplifiedTerms,
      omittedInternalItems,
    },
  };
}
