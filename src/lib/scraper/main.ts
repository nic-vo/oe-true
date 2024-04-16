import path from 'path';
import puppeteer, { HTTPResponse } from 'puppeteer';
import fs from 'fs/promises';
import { sanitize } from 'isomorphic-dompurify';

const outputRootPath = path.join(
	process.cwd(),
	'.scraped',
	Date.now().toString(),
);
const root = 'https://open-ephys.org/';

// Contains the hrefs for all links, checked for each depth first search
const visitedLinks = new Set<string>();
const skippedLinks = new Set<string>();
const downloadedImages = new Map<string, number>();

// Init puppeteer browser and page
// Hit root url

const myHTMLImgSanitize = (fileName: string) => {
	return fileName
		.replaceAll(/:|\\|\/|<|>|"|\||\?|\*|=|\+|%|&|\.|~/g, '_')
		.replaceAll(/_+/g, '_');
};

(async () => {
	const browser = await puppeteer.launch({
		headless: false,
		defaultViewport: { height: 1920, width: 1080 },
	});
	const page = await (async () => {
		const pages = await browser.pages();
		return pages[0] ?? (await browser.newPage());
	})();

	const visitPage = async (url: string) => {
		const writePath =
			url === root
				? outputRootPath
				: path.join(outputRootPath, ...url.replace(root, '').split('/'));
		await fs.mkdir(writePath, { recursive: true });

		const imgHandler = async (response: HTTPResponse): Promise<void> => {
			const headers = response.headers();
			const type = headers['content-type'];
			const accepted = new Set(['image/gif', 'image/png', 'image/jpeg']);
			if (!accepted.has(type)) return;
			if (/ico/.test(response.url())) return;
			const buffer = await response.buffer();
			if (buffer.byteLength < 2000) return;
			const fileNameBase = response.url().split('/').pop();
			if (!fileNameBase) return;
			let fileName;
			switch (type) {
				case 'image/gif':
					fileName =
						myHTMLImgSanitize(fileNameBase).replace('.gif', '') + '.gif';
					break;
				case 'image/png':
					fileName =
						myHTMLImgSanitize(fileNameBase).replace('.png', '') + '.png';
					break;
				case 'image/jpeg':
					fileName =
						myHTMLImgSanitize(fileNameBase).replace('.jpg', '') + '.jpg';
					break;
				default:
					fileName = `unnamed_img_${Date.now()}`;
					break;
			}
			await fs.writeFile(
				path.join(writePath, fileName),
				await response.buffer(),
			);
			const count = downloadedImages.get(fileName);
			downloadedImages.set(fileName, count ? count + 1 : 1);
		};

		const contentHandler = async () => {
			const nodeHTML = await page.$eval(
				'[id=mainContent]',
				(node) => node.innerHTML,
			);
			const anchorsAndLinks = nodeHTML
				.replaceAll(
					/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/g,
					'[$2]($1)',
				)
				.replaceAll(/<li>(.*?)<\/li>/g, '- $1');
			const stripped = sanitize(
				anchorsAndLinks.replaceAll(/(<\/[^>]*>)/g, '$1\r\n'),
				{
					ALLOWED_TAGS: ['a', 'li', 'iframe'],
					ALLOWED_ATTR: ['href', 'src'],
					ALLOW_ARIA_ATTR: false,
					ALLOW_DATA_ATTR: false,
					KEEP_CONTENT: true,
				},
			)
				.replaceAll(/&nbsp;/g, ' ')
				// .replaceAll(/<a><\/a>/g, '')
				// .replaceAll(
				// 	/\<a href=(["'])([^"'?]*)(\?[^"']*)*(["'])\>([^<]+)\<\/a\>/g,
				// 	'[$5]($2)',
				// )
				// .replaceAll(/\[\W+\]\(([^(]+)\)/g, '')
				// .replaceAll(/\[(\r?\n+)(\w+)(\r?\n+)\]/g, '[$2]')
				// .replaceAll(/<li>([^<]+)<\/li>/g, '\r\n- $1\r\n')
				.replaceAll(/<a[^>]*>(?:\s|&nbsp;)*<\/a>/g, '')
				.replaceAll(/ {2,}/g, '')
				.replaceAll(/\r?\n +/g, '\r\n')
				.replaceAll(/(\r?\n){2,}/g, '\r\n\r\n')
				.replaceAll(/\[(\r?\n)+(\w|\d)/g, '[$2')
				.replaceAll(/(\w|\d)(\r?\n)+\[/g, '$1]');
			console.log(stripped);
			await fs.writeFile(path.join(writePath, 'content.md'), stripped);
		};

		page.on('domcontentloaded', contentHandler);
		page.on('response', imgHandler);
		await page.goto(url, { waitUntil: 'networkidle0' });
		page.off('response', imgHandler);
		visitedLinks.add(url);
		page.off('domcontentloaded', contentHandler);

		const links = await page.$$eval('a', (tags) => tags.map((tag) => tag.href));
		for (const link of links) {
			if (link === '' || visitedLinks.has(link)) continue;
			if (
				/^https:\/\/(www\.)?open\-ephys\.org/.test(link) === false ||
				/\.pdf$/.test(link) ||
				/#.*$/.test(link) ||
				/\?.*$/.test(link)
			) {
				if (!skippedLinks.has(link)) {
					console.log('skipping:', link);
					skippedLinks.add(link);
				}
				continue;
			}
			console.log('next:', link);
			await visitPage(link);
		}
		console.log('\nEND OF BRANCH FROM\n', url);
	};
	await visitPage(root);

	await page.close();
	await browser.close();

	await fs.mkdir(outputRootPath, { recursive: true });
	await fs.writeFile(
		path.join(outputRootPath, 'log.json'),
		JSON.stringify({
			visited: Array.from(visitedLinks),
			skipped: Array.from(skippedLinks),
			images: Array.from(downloadedImages.entries()).map(
				([fileName, number]) => {
					return {
						fileName,
						number,
					};
				},
			),
		}),
	);

	console.log('\nDONE.\n');
	process.exit();
})();
