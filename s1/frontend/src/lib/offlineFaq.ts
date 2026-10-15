/**
 * Offline FAQ knowledge base for Voice Assistant (Feature #5).
 * Used when the network is unavailable. Answers basic farming questions locally.
 */

interface FaqEntry {
  keywords: string[];
  answer: { en: string; hi: string; te: string };
}

export const OFFLINE_FAQ: FaqEntry[] = [
  {
    keywords: ['irrigate', 'water', 'irrigation', 'सिंचाई', 'నీరు', 'పెట్టాలా'],
    answer: {
      en: 'Generally irrigate when the top 2 to 3 cm of soil feels dry. Most field crops need watering every 7 to 10 days depending on weather.',
      hi: 'जब मिट्टी की ऊपरी 2-3 सेमी परत सूखी लगे तो सिंचाई करें। अधिकतर फसलों को मौसम के अनुसार 7-10 दिनों में एक बार पानी चाहिए।',
      te: 'నేల పై 2-3 సెంటీమీటర్లు ఎండిపోయినప్పుడు నీరు పెట్టండి. వాతావరణాన్ని బట్టి చాలా పంటలకు 7-10 రోజులకొకసారి నీరు అవసరం.',
    },
  },
  {
    keywords: ['fertilizer', 'npk', 'urea', 'dap', 'ఎరువు', 'उर्वरक'],
    answer: {
      en: 'Apply NPK fertilizer at sowing, then top-dress with nitrogen at 30 days and 60 days after planting. Always follow soil test recommendations.',
      hi: 'बुवाई के समय NPK उर्वरक डालें, फिर 30 और 60 दिन बाद नाइट्रोजन दें। हमेशा मिट्टी परीक्षण की सिफारिश का पालन करें।',
      te: 'విత్తే సమయంలో NPK వేయండి, తర్వాత 30 మరియు 60 రోజులకు నత్రజని వేయండి. నేల పరీక్ష సిఫార్సులను పాటించండి.',
    },
  },
  {
    keywords: ['disease', 'blight', 'fungal', 'pest', 'spray', 'వ్యాధి', 'रोग'],
    answer: {
      en: 'For fungal diseases, spray Mancozeb or Copper Oxychloride at 2.5 g per litre of water. Repeat every 10 days. Remove and burn infected leaves.',
      hi: 'फफूंद रोगों के लिए मैन्कोज़ेब या कॉपर ऑक्सीक्लोराइड 2.5 ग्राम प्रति लीटर पानी में छिड़कें। 10 दिन में दोहराएं। संक्रमित पत्तियां जला दें।',
      te: 'శిలీంధ్ర వ్యాధులకు మాంకోజెబ్ లేదా కాపర్ ఆక్సీక్లోరైడ్ 2.5 గ్రా/లీటర్ నీటిలో పిచికారీ చేయండి. 10 రోజులకొకసారి పునరావృతం చేయండి.',
    },
  },
  {
    keywords: ['sowing', 'planting', 'seed', 'when to plant', 'విత్తడం', 'बुवाई'],
    answer: {
      en: 'Kharif crops like rice, cotton, and maize are sown in June to July. Rabi crops like wheat and chickpea are planted in October to November.',
      hi: 'खरीफ फसलें जैसे धान, कपास, मक्का जून-जुलाई में बोई जाती हैं। रबी फसलें जैसे गेहूं, चना अक्टूबर-नवंबर में लगाई जाती हैं।',
      te: 'వరి, పత్తి, మొక్కజొన్న వంటి ఖరీఫ్ పంటలు జూన్-జులైలో విత్తుతారు. గోధుమ, శనగలు వంటి రబీ పంటలు అక్టోబర్-నవంబర్‌లో వేస్తారు.',
    },
  },
  {
    keywords: ['weather', 'rain', 'temperature', 'forecast', 'వాతావరణం', 'मौसम'],
    answer: {
      en: 'I cannot fetch live weather while offline. Please check a weather app or reconnect to internet for current conditions.',
      hi: 'ऑफलाइन होने पर मैं मौसम की जानकारी नहीं दे सकता। कृपया इंटरनेट से जुड़ें या कोई मौसम ऐप देखें।',
      te: 'ఆఫ్‌లైన్‌లో వాతావరణ సమాచారం అందించలేను. దయచేసి ఇంటర్నెట్‌కు కనెక్ట్ అవ్వండి.',
    },
  },
  {
    keywords: ['market', 'price', 'msp', 'rate', 'sell', 'బాజారు', 'ధర', 'बाज़ार'],
    answer: {
      en: 'I cannot check live market prices while offline. Current government MSP rates: Rice ₹2300/qtl, Wheat ₹2275/qtl, Cotton ₹7121/qtl, Groundnut ₹6377/qtl.',
      hi: 'ऑफलाइन होने पर लाइव बाजार भाव नहीं देख सकते। सरकारी MSP: धान ₹2300/क्विंटल, गेहूं ₹2275/क्विंटल, कपास ₹7121/क्विंटल, मूंगफली ₹6377/क्विंटल।',
      te: 'ఆఫ్‌లైన్‌లో మార్కెట్ ధరలు చూడలేను. ప్రభుత్వ MSP: వరి ₹2300/క్వింటాల్, పత్తి ₹7121/క్వింటాల్, వేరుశెనగ ₹6377/క్వింటాల్.',
    },
  },
  {
    keywords: ['soil', 'ph', 'test', 'నేల', 'मिट्टी'],
    answer: {
      en: 'Ideal soil pH for most crops is 6.0 to 7.5. Test your soil every 2 years. Add lime to raise pH, add sulphur to lower it.',
      hi: 'अधिकतर फसलों के लिए आदर्श pH 6.0 से 7.5 है। हर 2 साल में मिट्टी परीक्षण करें। pH बढ़ाने के लिए चूना, घटाने के लिए सल्फर मिलाएं।',
      te: 'చాలా పంటలకు ఆదర్శ pH 6.0 నుండి 7.5. ప్రతి 2 సంవత్సరాలకు నేల పరీక్ష చేయించండి. pH పెంచడానికి సున్నం, తగ్గించడానికి సల్ఫర్ వేయండి.',
    },
  },
  {
    keywords: ['crop rotation', 'rotation', 'intercrop', 'పంట మార్పిడి', 'फसल चक्र'],
    answer: {
      en: 'Rotate cereals with legumes every season to restore soil nitrogen. For example, follow rice with chickpea or moong to improve soil health.',
      hi: 'हर सीजन अनाज फसलों के बाद दलहन फसलें उगाएं जिससे मिट्टी में नाइट्रोजन बढ़े। जैसे धान के बाद चना या मूंग लगाएं।',
      te: 'నేలలో నత్రజని పునరుద్ధరణకు ధాన్యపు పంటల తర్వాత పప్పు పంటలు వేయండి. ఉదాహరణకు వరి తర్వాత శనగలు లేదా పెసర వేయండి.',
    },
  },
  {
    keywords: ['harvest', 'cutting', 'yield', 'కోత', 'फसल काटना'],
    answer: {
      en: 'Harvest when grain moisture is 20 to 25 percent for mechanized harvesting, or when leaves turn yellow and lower grain is fully formed.',
      hi: 'यांत्रिक कटाई के लिए 20-25% नमी पर कटाई करें, या जब पत्तियां पीली पड़ जाएं और नीचे के दाने पूरे भर जाएं।',
      te: 'యంత్ర కోతకు 20-25% తేమ ఉన్నప్పుడు కోయండి, లేదా ఆకులు పసుపు పడి కింది గింజలు పూర్తిగా నిండినప్పుడు.',
    },
  },
  {
    keywords: ['store', 'storage', 'grain storage', 'నిల్వ', 'भंडारण'],
    answer: {
      en: 'Store grains at moisture below 12 percent to prevent fungal growth. Use airtight metal bins or jute bags with neem leaves to deter pests.',
      hi: 'कवक से बचाने के लिए 12% से कम नमी पर अनाज रखें। वायुरोधी धातु के डिब्बे या नीम की पत्तियों वाली बोरियों में भंडारण करें।',
      te: 'శిలీంధ్రాలను నిరోధించడానికి 12% కంటే తక్కువ తేమలో నిల్వ చేయండి. గాలి చొరబడని లోహపు డబ్బాలు లేదా వేప ఆకులతో జనపనార సంచులు వాడండి.',
    },
  },
];

/**
 * Find best offline answer for a query. Returns null if no good match.
 */
export function findOfflineAnswer(query: string, lang: string): string | null {
  const q = query.toLowerCase();
  for (const faq of OFFLINE_FAQ) {
    if (faq.keywords.some(kw => q.includes(kw.toLowerCase()))) {
      const answer = faq.answer[lang as keyof typeof faq.answer] || faq.answer.en;
      return answer;
    }
  }
  return null;
}
