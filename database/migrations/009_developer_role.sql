-- Developer: same permissions as the administrator; the role only tells them apart.
alter type user_role add value if not exists 'DESARROLLADOR';
