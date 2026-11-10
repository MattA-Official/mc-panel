# Testing 1.0.1

Thanks for testing. 1.0.1 adds an **update channel**: choose whether Flytower offers only stable releases, or betas too, so new features can be tried before they're released to everyone. See [Updating](../updating.md#stable-or-beta).

Allow about 10 minutes.

## 1. The test build

Install this pull request's test build on the test VPS (the command is in the pull request). Test builds have a version like `1.1.0-pr.74.1`.

- [ ] **System**, **Flytower** shows an **Update channel** with **Stable** and **Beta**.
- [ ] Because the test build's version has a `-suffix`, it starts on **Beta** (a beta install assumes Beta until you choose).
- [ ] Choose **Stable**. A line explains that you won't be taken backwards, and the card says it's up to date (1.0.0 is older than the test build).
- [ ] Reload the page: your choice is kept.
- [ ] **Activity** shows "Chose stable releases only" (and "Chose to be offered beta releases" when you switch back).

## 2. After release

Once 1.0.1 is out, the real test: on a box running 1.0.1 with **Stable** chosen, nothing changes when the first 1.1.0 beta is published. Choose **Beta**, and **Check now** offers it with a **Beta** badge and a warning. Updating to it works like any update, and **Go back to 1.0.1** returns you.

- [ ] A fresh install with no options installs 1.0.1, not the beta. With `--beta` it installs the beta.

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest.
