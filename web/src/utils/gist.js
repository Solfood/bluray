import { Octokit } from '@octokit/rest';

const GIST_DESCRIPTION = 'bluray-app-settings';
const GIST_FILENAME = 'settings.json';

export async function loadSettingsFromGist(token) {
  const octokit = new Octokit({ auth: token });
  const { data: gists } = await octokit.rest.gists.list({ per_page: 100 });
  const target = gists.find((g) => g.description === GIST_DESCRIPTION);
  if (!target) return null;

  const { data: gist } = await octokit.rest.gists.get({ gist_id: target.id });
  const content = gist.files[GIST_FILENAME]?.content;
  if (!content) return null;

  return JSON.parse(content);
}

export async function saveSettingsToGist(token, settings) {
  const octokit = new Octokit({ auth: token });
  const content = JSON.stringify(settings, null, 2);

  const { data: gists } = await octokit.rest.gists.list({ per_page: 100 });
  const existing = gists.find((g) => g.description === GIST_DESCRIPTION);

  if (existing) {
    await octokit.rest.gists.update({
      gist_id: existing.id,
      files: { [GIST_FILENAME]: { content } },
    });
  } else {
    await octokit.rest.gists.create({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content } },
    });
  }
}
