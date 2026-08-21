import React from 'react';
import Head from 'expo-router/head';
import LegalPage from '@/components/LegalPage';

/**
 * Required by CalOPPA the moment one Californian signs up, which is to say
 * immediately. Written to describe what the app actually does rather than
 * what a template assumes -- the visibility rules below are the ones RLS
 * enforces in the database.
 */
export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy — SellWant</title>
        <meta
          name="description"
          content="What SellWant collects, who can see it, and how to get it deleted. Your phone number and payment handles are only ever shown to someone you have agreed a deal with."
        />
      </Head>
      <LegalPage
        title="Privacy"
        updated="18 August 2026"
        intro="What we collect, who can see it, and how to get rid of it. Short, because we collect little, keep less, and sell none of it."
        sections={[
          {
            heading: 'What we collect',
            paragraphs: [
              'Your email address, so you can sign in and we can send you account emails.',
              'Your name, which is shown publicly on your listings and offers. Trading under a real name is how strangers decide whether to meet you.',
              'Your phone number, which is private until you agree a deal, and then shown to the other person so you can arrange to meet.',
              'Optionally an Instagram handle and a photo, both public if you add them. If you sign in with Google we take the name and photo from your Google profile so you do not have to type them again.',
              'Optionally payment handles such as Venmo or Zelle, shown only to someone you have a deal with. We never see a payment.',
              'What you post: listings, offers, counter-offers and messages on them. These are public by design.',
              'Basic technical data your browser sends, such as an IP address, used to serve and secure the site.',
              'Which pages get looked at. We count that a page was viewed — the address, and which listing it was — so we can see what people actually use. There is no cookie and no profile: views are grouped by a random number that lives in one browser tab and is thrown away when you close it, so we can tell one person reading four listings from four people reading one, and we cannot follow anybody between visits or across sites. Your IP is not stored with it.',
            ],
          },
          {
            heading: 'Who can see it',
            paragraphs: [
              'Anyone, signed in or not: listings, prices, offer amounts and the going rate. Logged-out visitors cannot see who posted or who offered.',
              'Signed-in people: names, photos, Instagram handles and completed-handoff counts.',
              'Only the two people in an agreed deal: each other’s phone number and payment handles. This is enforced in the database, not just in the interface.',
              'Nobody else. We do not sell your data, we do not share it with advertisers, and we do not run ad tracking. The page counts above are ours alone — they go to our own database, not to an analytics company, and they are read only by us.',
            ],
          },
          {
            heading: 'Who we use to run it',
            paragraphs: [
              'Supabase stores the database and handles sign-in. Cloudflare serves the site and sends our email. Google handles sign-in if you choose that option. Each sees only what it needs to do its job.',
              'These providers process data on our behalf. They are not permitted to use it for their own purposes.',
            ],
          },
          {
            heading: 'Email',
            paragraphs: [
              'We send account email: confirming your address, resetting a password, and notices about deals you are part of. These are necessary to use SellWant and cannot be switched off while you have an account.',
              'We do not send marketing email. If that ever changes it will be opt-in, with a working unsubscribe link.',
            ],
          },
          {
            heading: 'How long we keep it',
            paragraphs: [
              'Your account and its data stay until you delete them. Completed deals are kept as a record for both people involved.',
              'Ask us to delete your account and we will remove your profile, contact details, and listings. We may keep a minimal record of a completed deal, because the other person was party to it too.',
            ],
          },
          {
            heading: 'Your choices',
            paragraphs: [
              'You can see and edit your profile, contact details and payment handles from your profile page at any time.',
              'You can take down any listing you posted, and withdraw any offer you made.',
              'Depending on where you live you may have rights to access, correct, delete or export your data. Ask and we will do it — we do not require a legal citation first.',
            ],
          },
          {
            heading: 'Children',
            paragraphs: [
              'SellWant is for people 18 and over. We do not knowingly collect information from anyone under 18, and we delete accounts we learn belong to someone under 18.',
            ],
          },
          {
            heading: 'Security, honestly stated',
            paragraphs: [
              'Access rules are enforced in the database itself, so a mistake in the interface cannot expose private data on its own. Ticket codes are stored only as a one-way fingerprint, never as something a leak could use.',
              'No system is perfectly secure. If something goes wrong that affects you, we will tell you rather than hope you do not notice.',
            ],
          },
        ]}
      />
    </>
  );
}
