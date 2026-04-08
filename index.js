import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;

// قائمة User-Agents مختلفة للتبديل بينها
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ---------- إنشاء جلسة Axios مع headers ----------
function createSession() {
  return axios.create({
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept-Language': 'ar,en;q=0.9,en-US;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'Referer': 'https://ak.sv/',
    },
    timeout: 30000,
    decompress: true,
  });
}

// ---------- 1. البحث عن الأفلام ----------
async function searchMovies(query, maxPages = 3) {
  const encodedQuery = encodeURIComponent(query);
  const baseUrl = `https://ak.sv/search?q=${encodedQuery}`;
  let allResults = [];
  let page = 1;

  console.log(`🔍 جاري البحث عن: ${query}`);

  while (page <= maxPages) {
    const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
    try {
      console.log(`📄 محاولة جلب الصفحة ${page}: ${url}`);
      const session = createSession();
      const { data, status } = await session.get(url);
      console.log(`✅ تم جلب الصفحة ${page} - الحالة: ${status}`);
      
      const $ = cheerio.load(data);
      const movieEntries = $('div.entry-box');

      console.log(`📊 عدد النتائج في الصفحة ${page}: ${movieEntries.length}`);

      if (movieEntries.length === 0) break;

      const pageResults = [];
      movieEntries.each((i, el) => {
        const imgTag = $(el).find('img');
        let imgUrl = imgTag.attr('data-src') || imgTag.attr('src') || '';
        if (imgUrl.includes('placeholder')) imgUrl = imgTag.attr('data-src') || '';
        if (imgUrl && !imgUrl.startsWith('http')) {
          imgUrl = imgUrl.startsWith('//') ? 'https:' + imgUrl : imgUrl;
        }

        const genreSpans = $(el).find('span.badge-light');
        const genres = genreSpans.map((i, span) => $(span).text().trim()).get().join(', ') || 'غير محدد';

        const linkTag = $(el).find('a[href*="/movie/"]');
        let movieUrl = linkTag.attr('href');
        if (movieUrl && !movieUrl.startsWith('http')) {
          movieUrl = 'https://ak.sv' + movieUrl;
        }

        const titleTag = $(el).find('h3 a');
        const title = titleTag.text().trim() || 'بدون عنوان';

        if (title && movieUrl) {
          pageResults.push({ title, image: imgUrl, genres, url: movieUrl });
        }
      });

      if (pageResults.length === 0) break;
      allResults.push(...pageResults);
      page++;

      const nextBtn = $('a:contains("التالي"), a:contains("next"), a:contains("»")').last();
      if (nextBtn.length === 0 || !nextBtn.attr('href')) break;
      
      // تأخير بسيط بين الصفحات
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      console.error(`❌ خطأ في الصفحة ${page}:`, err.message);
      break;
    }
  }
  
  console.log(`🎯 إجمالي النتائج: ${allResults.length}`);
  return allResults;
}

// ---------- 2. جلب جميع تفاصيل الفيلم ----------
async function getMovieDetails(movieUrl) {
  const session = createSession();
  const { data } = await session.get(movieUrl);
  const $ = cheerio.load(data);

  const title = $('h1.entry-title').text().trim() || 'غير معروف';

  // القصة
  let story = 'لا توجد قصة متاحة';
  const storyDiv = $('div.widget-body');
  if (storyDiv.length) {
    const storyH2 = storyDiv.find('h2');
    if (storyH2.length) {
      let storyText = storyH2.text().trim();
      storyText = storyText.replace(/فيلم\s+.+?undefined/, '').trim();
      story = storyText || story;
    }
  }

  // المعلومات الأساسية
  const info = {};
  $('div.font-size-16.text-white.mt-2').each((i, el) => {
    const text = $(el).text().trim();
    const colonIndex = text.indexOf(':');
    if (colonIndex !== -1) {
      const key = text.substring(0, colonIndex).trim();
      let value = text.substring(colonIndex + 1).trim();
      if (key === 'اللغة') info.language = value;
      else if (key === 'الترجمة') info.subtitle = value;
      else if (key === 'جودة الفيلم') info.quality = value;
      else if (key === 'انتاج') info.production = value;
      else if (key === 'السنة') info.year = value;
      else if (key === 'مدة الفيلم') info.duration = value;
    }
  });

  const language = info.language || 'غير محدد';
  const subtitle = info.subtitle || 'غير محدد';
  const quality = info.quality || 'غير محدد';
  const production = info.production || 'غير محدد';
  const year = info.year || 'غير محدد';
  const duration = info.duration || 'غير محدد';

  // التواريخ
  let addedDate = 'غير محدد';
  let lastUpdate = 'غير محدد';
  const addedElem = $('div.font-size-14.text-muted.mt-3 span');
  if (addedElem.length) {
    const addedText = addedElem.text().trim();
    if (addedText.includes('تـ الإضافة')) {
      addedDate = addedText.split(':')[1]?.trim() || addedText;
    }
  }
  const updateElem = $('div.font-size-14.text-muted span');
  if (updateElem.length) {
    const updateText = updateElem.text().trim();
    if (updateText.includes('تـ اخر تحديث')) {
      lastUpdate = updateText.split(':')[1]?.trim() || updateText;
    }
  }

  // الأنواع
  let genres = 'غير محدد';
  const genreLinks = $('div.d-flex.align-items-center.mt-3 a.badge-light');
  if (genreLinks.length) {
    genres = genreLinks.map((i, el) => $(el).text().trim()).get().join(', ');
  }

  // فريق العمل
  const cast = [];
  $('div.entry-box-3').each((i, el) => {
    const img = $(el).find('img');
    let imgUrl = img.attr('src') || '';
    if (imgUrl && !imgUrl.startsWith('http')) imgUrl = 'https:' + imgUrl;
    const name = $(el).find('div.entry-title').text().trim();
    if (name) cast.push({ name, image: imgUrl });
  });

  // روابط التحميل الوسيطة
  const downloads = [];
  const tabs = $('div.tab-content.quality');
  tabs.each((i, tab) => {
    const tabId = $(tab).attr('id');
    const qualityBtn = $(`a[href="#${tabId}"]`);
    let qualityText = qualityBtn.text().trim();
    if (!qualityText) qualityText = tabId.replace('tab-', '') + 'p';

    let watchUrl = null, downloadUrl = null, size = null;
    const rows = $(tab).find('div.row');
    rows.each((j, row) => {
      const watchLink = $(row).find('a.link-show');
      if (watchLink.length) watchUrl = watchLink.attr('href');
      const downloadLink = $(row).find('a.link-download');
      if (downloadLink.length) {
        downloadUrl = downloadLink.attr('href');
        const sizeSpan = downloadLink.find('span.font-size-14');
        if (sizeSpan.length) size = sizeSpan.text().trim();
      }
      if (downloadUrl) return false;
    });
    if (downloadUrl) downloads.push({ quality: qualityText, watchUrl, downloadUrl, size: size || 'غير محدد' });
  });

  return {
    title,
    story,
    language,
    subtitle,
    quality,
    production,
    year,
    duration,
    addedDate,
    lastUpdate,
    genres,
    cast,
    downloads,
  };
}

// ---------- 3. جلب التفاصيل مع الروابط الوسيطة فقط (لتفادي الحظر) ----------
async function getMovieDetailsWithIntermediateLinks(movieUrl) {
  const details = await getMovieDetails(movieUrl);
  const downloadsObj = {};
  
  for (const dl of details.downloads) {
    // نحتفظ بالرابط الوسيط فقط، ولا نحاول جلب الرابط المباشر لتجنب الحظر
    downloadsObj[dl.quality] = {
      size: dl.size,
      watchUrl: dl.watchUrl,
      intermediateUrl: dl.downloadUrl,
      directUrl: null,
      message: "الرابط الوسيط يعمل بشكل طبيعي. اضغط عليه ثم اختر تحميل من الصفحة التي ستفتح."
    };
  }
  
  details.downloads = downloadsObj;
  return details;
}

// ---------- 4. API Routes ----------

// نقطة نهاية ترحيبية (الرابط الأساسي)
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'مرحباً بك في API بحث و تحميل افلام من منصه اكاوم by monte',
    endpoints: {
      search: '/?search=اسم_الفيلم',
      movieDetails: '/?url=رابط_الفيلم'
    },
    example: {
      search: 'https://monte-apis-dev-search-ak.vercel.app/?search=spider-man',
      movieDetails: 'https://monte-apis-dev-search-ak.vercel.app/?url=https://ak.sv/movie/8601/spider-man-across-the-spider-verse'
    }
  });
});

app.get('/api', async (req, res) => {
  const { search, url } = req.query;
  try {
    if (search) {
      console.log(`📥 طلب بحث: ${search}`);
      const results = await searchMovies(search, 3);
      console.log(`📤 إرجاع ${results.length} نتيجة`);
      return res.json({ success: true, data: results });
    } 
    else if (url) {
      console.log(`📥 طلب تفاصيل: ${url}`);
      const details = await getMovieDetailsWithIntermediateLinks(url);
      const orderedDetails = {
        title: details.title,
        story: details.story,
        language: details.language,
        subtitle: details.subtitle,
        quality: details.quality,
        production: details.production,
        year: details.year,
        duration: details.duration,
        addedDate: details.addedDate,
        lastUpdate: details.lastUpdate,
        genres: details.genres,
        cast: details.cast,
        downloads: details.downloads,
      };
      console.log(`📤 إرجاع تفاصيل فيلم: ${details.title}`);
      return res.json({ success: true, data: orderedDetails });
    }
    else {
      return res.status(400).json({ 
        success: false, 
        error: 'يرجى توفير معامل search أو url',
        example: {
          search: '/?search=spider-man',
          url: '/?url=https://ak.sv/movie/8601/spider-man-across-the-spider-verse'
        }
      });
    }
  } catch (err) {
    console.error('❌ خطأ:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API يعمل على المنفذ ${PORT}`);
});
