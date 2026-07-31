import { redirect } from 'next/navigation';

export default function RetiredGeoProjectsPage() {
  redirect('/admin/settings#workspace');
}
